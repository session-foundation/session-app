#import <React/RCTAnimatedImage.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTImageURLLoader.h>

#import <ImageIO/ImageIO.h>
#import <UIKit/UIKit.h>
#import <os/log.h>

#include "DecodeBound.hpp"
#include "MediaSource.hpp"

#include <session_bridge/media_url.hpp>

#include <algorithm>
#include <atomic>
#include <memory>
#include <string>
#include <utility>

static NSString* const SessionMediaErrorDomain = @"SessionMedia";

static NSError* SessionMediaError(const std::string& message) {
    return [NSError errorWithDomain:SessionMediaErrorDomain
                               code:1
                           userInfo:@{
                               NSLocalizedDescriptionKey : [NSString stringWithUTF8String:message.c_str()]
                           }];
}

/// React Native reports a failed load to the view's `onError` and nowhere else, so this is the
/// only trace of why.
static void Fail(RCTImageLoaderCompletionBlock done, NSURL* url, const std::string& message) {
    static os_log_t channel = os_log_create("org.getsession", "SessionMedia");
    os_log(channel, "%{public}@ did not load: %{public}s", url.absoluteString, message.c_str());
    done(SessionMediaError(message), nil);
}

/// The source's stored pixel size from its header, or zero when it does not say. A GIF's frames
/// are drawn onto its canvas, so for a GIF the larger of the two on each edge.
static CGSize SourcePixelSize(CGImageSourceRef source) {
    NSDictionary* frame =
            (__bridge_transfer NSDictionary*)CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr);
    NSDictionary* container =
            (__bridge_transfer NSDictionary*)CGImageSourceCopyProperties(source, nullptr);
    NSDictionary* gif = container[(id)kCGImagePropertyGIFDictionary];
    return CGSizeMake(
            std::max(
                    [frame[(id)kCGImagePropertyPixelWidth] doubleValue],
                    [gif[(id)kCGImagePropertyGIFCanvasPixelWidth] doubleValue]),
            std::max(
                    [frame[(id)kCGImagePropertyPixelHeight] doubleValue],
                    [gif[(id)kCGImagePropertyGIFCanvasPixelHeight] doubleValue]));
}

// TODO: ImageIO decodes a GIF or most PNGs whole; serve a format it reduces while decoding.
/// Decodes on the calling queue rather than at first draw, and no larger than the view asks for or
/// the pixel budget allows: a thumbnail with the file's orientation applied, which is also what
/// keeps a 12-megapixel photo from being held whole for a tile.
static UIImage* _Nullable DecodedImage(
        CGImageSourceRef source, CGSize pixels, CGSize size, CGFloat scale) {
    const CGFloat longest = std::max(size.width, size.height) * std::max<CGFloat>(scale, 1);
    const CGFloat bound =
            ::session_bridge_rn::decode_edge_bound(longest, pixels.width, pixels.height);
    NSDictionary* options = @{
        (id)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
        (id)kCGImageSourceCreateThumbnailWithTransform : @YES,
        (id)kCGImageSourceShouldCacheImmediately : @YES,
        (id)kCGImageSourceThumbnailMaxPixelSize : @(bound),
    };
    CGImageRef decoded =
            CGImageSourceCreateThumbnailAtIndex(source, 0, (__bridge CFDictionaryRef)options);
    if (!decoded)
        return nil;
    UIImage* image = [UIImage imageWithCGImage:decoded scale:std::max<CGFloat>(scale, 1)
                                   orientation:UIImageOrientationUp];
    CGImageRelease(decoded);
    return image;
}

/// A preview's RGBA, which is not premultiplied - what `kCGImageAlphaLast` describes.
static UIImage* _Nullable PreviewImage(std::shared_ptr<::session_bridge::Preview> preview) {
    // Bounded as doubles first: a JavaScript source may answer NaN or 1e12, and casting either
    // to size_t is undefined before the check would run.
    constexpr double max_edge = 16384;
    const double w = preview->width, h = preview->height;
    if (!(w > 0 && w <= max_edge && h > 0 && h <= max_edge))
        return nil;
    const auto width = static_cast<size_t>(w);
    const auto height = static_cast<size_t>(h);
    if (preview->rgba.size() != width * height * 4)
        return nil;
    // The provider keeps the preview alive for as long as the image needs its pixels.
    auto* held = new std::shared_ptr<::session_bridge::Preview>(std::move(preview));
    CGDataProviderRef provider = CGDataProviderCreateWithData(
            held, (*held)->rgba.data(), (*held)->rgba.size(), [](void* info, const void*, size_t) {
                delete static_cast<std::shared_ptr<::session_bridge::Preview>*>(info);
            });
    CGColorSpaceRef colours = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGImageRef image = CGImageCreate(
            width,
            height,
            8,
            32,
            width * 4,
            colours,
            kCGBitmapByteOrderDefault | kCGImageAlphaLast,
            provider,
            nullptr,
            false,
            kCGRenderingIntentDefault);
    CGColorSpaceRelease(colours);
    CGDataProviderRelease(provider);
    if (!image)
        return nil;
    UIImage* result = [UIImage imageWithCGImage:image];
    CGImageRelease(image);
    return result;
}

/// Decoded tiles and previews, keyed by URL, size and scale. React Native caches only what it
/// decoded itself from an HTTP response, so a loader's answers would otherwise decode again on
/// every mount; bounded per entry so a viewer-size picture never evicts a screen of tiles. A URL
/// keeps naming one picture: libsession never reuses a message id, and a discard calls
/// `forget_media`.
static const NSUInteger kCacheTotalCostBytes = 48 * 1024 * 1024;
static const NSUInteger kCacheEntryCostLimitBytes = 4 * 1024 * 1024;

static NSString* CacheKey(NSURL* url, CGSize size, CGFloat scale) {
    return [NSString stringWithFormat:@"%@|%.0f|%.0f|%.2f",
                                      url.absoluteString,
                                      size.width,
                                      size.height,
                                      scale];
}

static void Remember(NSCache<NSString*, UIImage*>* cache, NSString* key, UIImage* image) {
    CGImageRef pixels = image.CGImage;
    if (!pixels)
        return;
    const NSUInteger cost = CGImageGetBytesPerRow(pixels) * CGImageGetHeight(pixels);
    if (cost > 0 && cost <= kCacheEntryCostLimitBytes)
        [cache setObject:image forKey:key cost:cost];
}

/**
 * Draws `session-media://` URLs: the image loader behind `MediaPort.urlFor` on iOS.
 *
 * Registered through `codegenConfig.ios.modulesConformingToProtocol` in this package's
 * package.json, which is what reaches React Native's image loader on the new architecture. The URL
 * is the request: parsed here, answered by whichever source is serving - the open bridge, or the
 * fake through `serveMediaFrom` - and never passed through JavaScript.
 */
@interface SessionMediaImageLoader : NSObject <RCTBridgeModule, RCTImageURLLoader>
@end

@implementation SessionMediaImageLoader {
    dispatch_queue_t _drain;
    NSCache<NSString*, UIImage*>* _cache;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

// TODO: admit decodes by their summed peak estimated from the header (whole for a GIF or PNG),
// refusing one that os_proc_available_memory() less that sum and a margin cannot hold.
/// Concurrent: every block owns what it touches, and a microsecond preview must not wait behind
/// an album's decodes.
- (instancetype)init {
    if (self = [super init]) {
        _drain = dispatch_queue_create(
                "session-media",
                dispatch_queue_attr_make_with_qos_class(
                        DISPATCH_QUEUE_CONCURRENT, QOS_CLASS_USER_INITIATED, 0));
        _cache = [NSCache new];
        _cache.name = @"session-media";
        _cache.totalCostLimit = kCacheTotalCostBytes;
        // Emptied when React Native's own image cache is: under memory pressure, and on resigning
        // active, which Control Center, a system alert or the app switcher also cause.
        NSNotificationCenter* centre = NSNotificationCenter.defaultCenter;
        [centre addObserver:_cache
                   selector:@selector(removeAllObjects)
                       name:UIApplicationDidReceiveMemoryWarningNotification
                     object:nil];
        [centre addObserver:_cache
                   selector:@selector(removeAllObjects)
                       name:UIApplicationWillResignActiveNotification
                     object:nil];
        __weak NSCache<NSString*, UIImage*>* cache = _cache;
        session_bridge_rn::set_media_forgetter([cache] { [cache removeAllObjects]; });
    }
    return self;
}

- (void)dealloc {
    [NSNotificationCenter.defaultCenter removeObserver:_cache];
}

- (BOOL)canLoadImageURL:(NSURL*)requestURL {
    return [requestURL.scheme isEqualToString:@"session-media"];
}

- (BOOL)requiresScheduling {
    return YES;
}

/// React Native's cache takes only the images it decodes itself from an HTTP response; this
/// loader keeps its own.
- (BOOL)shouldCacheLoadedImages {
    return NO;
}

- (float)loaderPriority {
    return 10;
}

/// Starts the fetch and returns: the answer arrives on Core's loop or the JS thread, where it is
/// only handed to this loader's own queue, which checks it, decodes it and completes.
- (nullable RCTImageLoaderCancellationBlock)loadImageForURL:(NSURL*)imageURL
                                                       size:(CGSize)size
                                                      scale:(CGFloat)scale
                                                 resizeMode:(RCTResizeMode)resizeMode
                                            progressHandler:(RCTImageLoaderProgressBlock)progressHandler
                                         partialLoadHandler:
                                                 (RCTImageLoaderPartialLoadBlock)partialLoadHandler
                                          completionHandler:
                                                  (RCTImageLoaderCompletionBlock)completionHandler {
    const auto parsed = ::session_bridge::parse_media_url(imageURL.absoluteString.UTF8String);
    if (!parsed) {
        Fail(completionHandler, imageURL, "not a media URL");
        return nil;
    }
    NSString* key = CacheKey(imageURL, size, scale);
    if (UIImage* cached = [_cache objectForKey:key]) {
        completionHandler(nil, cached);
        return nil;
    }
    auto source = ::session_bridge_rn::media_source();
    if (!source) {
        Fail(completionHandler, imageURL, "nothing is serving media");
        return nil;
    }

    auto cancelled = std::make_shared<std::atomic<bool>>(false);
    dispatch_queue_t drain = _drain;
    NSCache<NSString*, UIImage*>* cache = _cache;
    RCTImageLoaderCompletionBlock done = [completionHandler copy];

    if (parsed->kind == ::session_bridge::MediaUrlKind::preview) {
        source->fetch_preview(parsed->message_id, parsed->index, [=](::session_bridge::Preview answer) {
            auto preview = std::make_shared<::session_bridge::Preview>(std::move(answer));
            dispatch_async(drain, ^{
                if (cancelled->load())
                    return;
                if (preview->error) {
                    Fail(done, imageURL, *preview->error);
                    return;
                }
                UIImage* image = PreviewImage(preview);
                if (!image) {
                    Fail(done, imageURL, "a preview whose pixels do not match its size");
                    return;
                }
                Remember(cache, key, image);
                done(nil, image);
            });
        });
    } else {
        source->fetch_media(parsed->message_id, parsed->index, [=](::session_bridge::Media answer) {
            auto media = std::make_shared<::session_bridge::Media>(std::move(answer));
            dispatch_async(drain, ^{
                if (cancelled->load())
                    return;
                if (media->error) {
                    Fail(done, imageURL, *media->error);
                    return;
                }
                const auto type =
                        ::session_bridge::servable_image_type(media->content_type, media->bytes);
                if (!type) {
                    Fail(done, imageURL, "not a picture the decoder may be handed");
                    return;
                }
                // Not copied: the deallocator holds `media` for as long as ImageIO holds the data.
                NSData* data = [[NSData alloc] initWithBytesNoCopy:media->bytes.data()
                                                            length:media->bytes.size()
                                                       deallocator:^(void*, NSUInteger) {
                                                           (void)media;
                                                       }];
                CGImageSourceRef imageSource =
                        CGImageSourceCreateWithData((__bridge CFDataRef)data, nullptr);
                if (!imageSource) {
                    Fail(done, imageURL, "the picture did not decode");
                    return;
                }
                const CGSize pixels = SourcePixelSize(imageSource);
                if (::session_bridge_rn::exceeds_whole_decode_ceiling(
                            *type, pixels.width, pixels.height)) {
                    CFRelease(imageSource);
                    Fail(done, imageURL, "a GIF or PNG too large to decode whole");
                    return;
                }
                // `RCTAnimatedImage` decodes every frame at full canvas size, at draw, so only an
                // animation within the budget is one; anything else is its first frame, bounded.
                const bool animated = *type == "image/gif"
                                      && CGImageSourceGetCount(imageSource) > 1
                                      && ::session_bridge_rn::fits_decode_budget(
                                              pixels.width, pixels.height);
                UIImage* image = animated ? [[RCTAnimatedImage alloc] initWithData:data scale:scale]
                                          : DecodedImage(imageSource, pixels, size, scale);
                CFRelease(imageSource);
                if (!image) {
                    Fail(done, imageURL, "the picture did not decode");
                    return;
                }
                // An animated image holds its source and the file's bytes, which its poster frame
                // does not measure, so only stills are kept.
                if (!animated)
                    Remember(cache, key, image);
                done(nil, image);
            });
        });
    }

    return ^{
        cancelled->store(true);
    };
}

@end
