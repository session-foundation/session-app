#import <UIKit/UIKit.h>
#import <objc/runtime.h>

#import <react/renderer/attributedstring/ParagraphAttributes.h>
#import <react/renderer/textlayoutmanager/RCTTextLayoutManager.h>

using facebook::react::ParagraphAttributes;

/**
 * Text drawn into a frame a hair shorter than it was measured at loses its last line on iOS 26.
 *
 * Yoga places views on the pixel grid, and on a fractional position its float rounding can leave a
 * text's frame about 1e-4 pt short of the height the text measured (41.9998 for 42). React Native
 * builds the drawing text container at exactly the frame's size and, with no line limit, sets
 * NSLineBreakByClipping. iOS 26 applies that mode to the last line that fits the container, so the
 * first line is clipped rather than wrapped and the rest disappear. iOS 18 does not.
 *
 * Every text goes through the one method below, measuring and drawing alike, so this is where the
 * container gets its slack back. A hundredth of a point covers the rounding and is far below a
 * pixel at any scale, so nothing that already fits changes.
 *
 * The method is React Native's own, private, and reached here from the prebuilt core without
 * building it from source. `apps/mobile/tests/textContainerSlack.test.ts` checks React Native's
 * source still declares it with this signature; a debug build stops at launch if it has gone.
 */
static const CGFloat SLACK = 0.01;

static NSString *const SELECTOR =
    @"_textStorageAndLayoutManagerWithAttributesString:paragraphAttributes:size:";

typedef NSTextStorage *(*TextStorageForSize)(
    id, SEL, NSAttributedString *, ParagraphAttributes, CGSize);

static TextStorageForSize original;

static NSTextStorage *withSlack(
    id self, SEL cmd, NSAttributedString *string, ParagraphAttributes attributes, CGSize size)
{
  return original(self, cmd, string, attributes, CGSizeMake(size.width, size.height + SLACK));
}

@interface SessionTextContainerSlack : NSObject
@end

@implementation SessionTextContainerSlack

+ (void)load
{
  Method method = class_getInstanceMethod([RCTTextLayoutManager class], NSSelectorFromString(SELECTOR));
  if (method == NULL) {
    NSAssert(NO, @"RCTTextLayoutManager no longer has %@; see TextContainerSlack.mm", SELECTOR);
    return;
  }
  original = (TextStorageForSize)method_setImplementation(method, (IMP)withSlack);
}

@end
