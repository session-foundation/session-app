// The notification service extension: hands each push to the shared handler
// (packages/bridge-core/src/push_handler.cpp) and shows what libsession decides.
//
// For one push: find the app's database in the app group and its key in the shared keychain group,
// let `handle_cold_push` open it one-shot, receive or fetch the message, decide and claim what to
// show, and close it again -- before the notification is handed back, since a database held open
// past that point gets the process killed for holding a lock while suspended (0xdead10cc).
//
// What the app shares through the app group's defaults is named in
// modules/session-push/ios/AppGroup.swift: change both.

#import <Security/Security.h>
#import <UserNotifications/UserNotifications.h>
#import <os/log.h>

#include <oxenc/hex.h>
#include <session_bridge/push_handler.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <filesystem>
#include <optional>
#include <string>

using namespace std::literals;
namespace push = session::push;

@interface NotificationService : UNNotificationServiceExtension
@end

namespace {

/// The whole of a push, inside iOS's limit of about 30 s, with room to hand the notification back.
constexpr auto DEADLINE = 25s;

/// How long a database the app still holds is waited for: the app's close interrupts its SQL 15 s
/// after it leaves the screen (CLOSE_INTERRUPT_MS in apps/mobile/src/backgroundClose.ts).
constexpr auto OPEN_RETRY = 15s;

NSString* const WORDS_KEY = @"session.push.words";
NSString* const IN_FRONT_UNTIL_KEY = @"session.push.inFrontUntil";
NSString* const OPEN_CONVERSATION_KEY = @"session.push.openConversation";
NSString* const SOUND_KEY = @"session.push.sound";
/// The userInfo key a notification's id goes under; the app's own (AppGroup.swift) too.
NSString* const NOTIFICATION_ID_KEY = @"session_id";
/// The userInfo key the message a tap lands on goes under; the app's own (AppGroup.swift) too.
NSString* const MESSAGE_ID_KEY = @"session_message";
NSString* const MESSAGE_CATEGORY = @"session-message";

/// The networks a database may be under, in the order they are tried.
const char* const NETWORKS[] = {"mainnet", "testnet"};

os_log_t log_handle() {
    static os_log_t handle = os_log_create("org.getsession", "notification-service");
    return handle;
}

void log_line(std::string_view line) {
    os_log(log_handle(), "%{public}.*s", static_cast<int>(line.size()), line.data());
}

NSString* ns(const std::string& s) {
    return [NSString stringWithUTF8String:s.c_str()] ?: @"";
}

/// The app group, which app.config.ts writes into both Info.plists.
NSString* app_group() {
    return [NSBundle.mainBundle objectForInfoDictionaryKey:@"SessionAppGroup"];
}

NSUserDefaults* shared_defaults() {
    NSString* group = app_group();
    return group ? [[NSUserDefaults alloc] initWithSuiteName:group] : nil;
}

/// A word a notification is made of, in the language the app last handed over; English for a push
/// that arrives before the app has ever run.
NSString* word(NSString* key) {
    static NSDictionary* const english = @{
        @"appName": @"Session",
        @"generic": @"You've got a new message.",
        @"request": @"You have a new message request",
        @"you": @"You",
        @"image": @"Image",
        @"animated": @"GIF",
        @"video": @"Video",
        @"audio": @"Audio",
        @"voice": @"Voice Message",
        @"file": @"Document",
        @"attachments": @"Attachments",
    };
    NSDictionary* words = [shared_defaults() dictionaryForKey:WORDS_KEY];
    NSString* found = [words[key] isKindOfClass:NSString.class] ? words[key] : nil;
    return found ?: english[key] ?: @"";
}

/// Whether the app is in front, by its lease: see AppGroup.swift.
bool app_in_front() {
    NSUserDefaults* defaults = shared_defaults();
    return defaults &&
           [defaults doubleForKey:IN_FRONT_UNTIL_KEY] > NSDate.date.timeIntervalSince1970;
}

/// The sound the app last handed over, or Note, the default, before it has: the chosen sound's
/// quiet version while the app is in front, as legacy iOS plays, and none for None. The files are
/// in the app's bundle (modules/notification-sounds), where iOS looks up a sound by its name.
UNNotificationSound* chosen_sound() {
    NSString* name = [shared_defaults() stringForKey:SOUND_KEY] ?: @"note";
    if ([name isEqualToString:@"none"])
        return nil;
    NSString* format = app_in_front() ? @"%@-quiet.aifc" : @"%@.aifc";
    return [UNNotificationSound soundNamed:[NSString stringWithFormat:format, name]];
}

/// The conversation on screen in the app, trusted only while its lease runs: see AppGroup.swift.
std::optional<std::string> open_conversation() {
    if (!app_in_front())
        return std::nullopt;
    NSString* open = [shared_defaults() stringForKey:OPEN_CONVERSATION_KEY];
    return open.length ? std::optional<std::string>{open.UTF8String} : std::nullopt;
}

/// The app's database key: expo-secure-store's item in the keychain group the app and this
/// extension share. Its service is "app" plus ":no-auth" for an item stored without biometrics,
/// which is how the app stores it.
std::optional<std::array<std::byte, 32>> database_key() {
    NSData* account = [@"session.db.key.this-device" dataUsingEncoding:NSUTF8StringEncoding];
    for (NSString* service in @[@"app:no-auth", @"app"]) {
        NSDictionary* query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: service,
            (__bridge id)kSecAttrAccount: account,
            (__bridge id)kSecAttrGeneric: account,
            (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecMatchLimit: (__bridge id)kSecMatchLimitOne,
        };
        CFTypeRef found = nullptr;
        if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &found) != errSecSuccess || !found)
            continue;
        NSData* data = (__bridge_transfer NSData*)found;
        std::string hex{static_cast<const char*>(data.bytes), data.length};
        if (hex.size() != 64 || !oxenc::is_hex(hex))
            return std::nullopt;
        std::array<std::byte, 32> key;
        oxenc::from_hex(hex.begin(), hex.end(), key.begin());
        return key;
    }
    return std::nullopt;
}

NSString* attachment_word(const push::NotificationContent& c) {
    if (c.attachments > 1)
        return word(@"attachments");
    if (!c.attachment)
        return word(@"generic");
    switch (*c.attachment) {
        case push::AttachmentKind::image: return word(@"image");
        case push::AttachmentKind::animated: return word(@"animated");
        case push::AttachmentKind::video: return word(@"video");
        case push::AttachmentKind::audio: return word(@"audio");
        case push::AttachmentKind::voice: return word(@"voice");
        case push::AttachmentKind::file: return word(@"file");
    }
    return word(@"generic");
}

/// The notification for what libsession decided about `message_id`, on the push's own content.
UNMutableNotificationContent* content_for(
        const push::NotificationContent& c,
        std::optional<int64_t> message_id,
        UNNotificationContent* original) {
    UNMutableNotificationContent* out = [original mutableCopy];
    out.threadIdentifier = ns(c.thread);
    out.sound = chosen_sound();
    NSString* kind = @"generic";
    switch (c.kind) {
        case push::NotificationContent::Kind::generic:
            out.title = word(@"appName");
            out.body = word(@"generic");
            break;
        case push::NotificationContent::Kind::message_request:
            kind = @"message_request";
            out.title = word(@"appName");
            out.body = word(@"request");
            break;
        case push::NotificationContent::Kind::message:
            kind = @"message";
            // Mark read and Reply, registered by the app (SessionPushAppDelegateSubscriber.swift).
            out.categoryIdentifier = MESSAGE_CATEGORY;
            out.title = c.sender ? ns(*c.sender) : word(@"appName");
            out.body = c.body ? ns(*c.body) : attachment_word(c);
            break;
    }
    // What a tap opens: a message's conversation, which is its thread, on the message, or the
    // requests (see
    // SessionPushAppDelegateSubscriber.swift). And its id, by which it is taken down later: iOS
    // names a push's notification itself, and an extension cannot rename it.
    NSMutableDictionary* info = [out.userInfo mutableCopy] ?: [NSMutableDictionary dictionary];
    info[@"session_kind"] = kind;
    info[NOTIFICATION_ID_KEY] = ns(c.id);
    if (c.kind == push::NotificationContent::Kind::message && message_id)
        info[MESSAGE_ID_KEY] = @(*message_id);
    out.userInfo = info;
    return out;
}

/// Takes down shown notifications by their ids: the ones the app posted under their ids, and the
/// pushes' under the names iOS gave them, found by the id in their userInfo.
void take_down(NSArray<NSString*>* ids) {
    UNUserNotificationCenter* center = UNUserNotificationCenter.currentNotificationCenter;
    [center removeDeliveredNotificationsWithIdentifiers:ids];
    NSSet* stale = [NSSet setWithArray:ids];
    [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification*>* shown) {
      NSMutableArray* names = [NSMutableArray array];
      for (UNNotification* n in shown) {
          id tagged = n.request.content.userInfo[NOTIFICATION_ID_KEY];
          if ([tagged isKindOfClass:NSString.class] && [stale containsObject:tagged])
              [names addObject:n.request.identifier];
      }
      if (names.count)
          [center removeDeliveredNotificationsWithIdentifiers:names];
    }];
}

/// The database to hand a push to: the first network directory that has one.
std::optional<std::pair<std::filesystem::path, std::string>> database() {
    NSString* group = app_group();
    NSURL* container =
            group ? [NSFileManager.defaultManager
                            containerURLForSecurityApplicationGroupIdentifier:group]
                  : nil;
    if (!container)
        return std::nullopt;
    // The app's data root in the group, as modules/storage-roots makes it.
    auto root = std::filesystem::path{container.path.UTF8String} / "session";
    for (const char* netid : NETWORKS) {
        auto db = root / netid / "session.db";
        std::error_code ec;
        if (std::filesystem::exists(db, ec))
            return std::pair{db, std::string{netid}};
    }
    return std::nullopt;
}

}  // namespace

@implementation NotificationService {
    void (^_contentHandler)(UNNotificationContent*);
    UNNotificationContent* _original;
    std::atomic<bool> _delivered;
}

- (void)deliver:(UNNotificationContent*)content why:(const std::string&)why {
    if (_delivered.exchange(true))
        return;
    log_line("delivered: " + why);
    _contentHandler(content);
}

- (UNMutableNotificationContent*)genericContent {
    return content_for(session_bridge::generic_notification(), std::nullopt, _original);
}

- (void)didReceiveNotificationRequest:(UNNotificationRequest*)request
                   withContentHandler:(void (^)(UNNotificationContent*))contentHandler {
    _contentHandler = contentHandler;
    _original = request.content;
    _delivered = false;
    NSString* enc = request.content.userInfo[@"enc_payload"];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      [self handle:enc];
    });
}

- (void)handle:(NSString*)enc {
    if (!enc) {
        [self deliver:[self genericContent] why:"no enc_payload"];
        return;
    }
    auto db = database();
    if (!db) {
        [self deliver:[self genericContent] why:"no database"];
        return;
    }
    auto key = database_key();
    if (!key) {
        [self deliver:[self genericContent] why:"no database key"];
        return;
    }

    session_bridge::ColdPush where;
    where.db_path = db->first;
    where.netid = db->second;
    where.key = *key;
    where.open_retry_for = OPEN_RETRY;
    where.open = open_conversation();
    auto result = session_bridge::handle_cold_push(
            where,
            enc.UTF8String,
            word(@"you").UTF8String,
            std::chrono::duration_cast<std::chrono::milliseconds>(DEADLINE),
            log_line);

    if (!result.stale.empty()) {
        NSMutableArray* ids = [NSMutableArray array];
        for (const auto& id : result.stale)
            [ids addObject:ns(id)];
        take_down(ids);
    }

    UNMutableNotificationContent* out;
    if (result.show)
        out = content_for(*result.show, result.message_id, _original);
    else
        // Nothing to show. With the notification filtering entitlement, empty content shows
        // nothing at all; without it iOS shows the push's own text.
        out = [[UNMutableNotificationContent alloc] init];
    if (result.badge && out.title.length)
        out.badge = @(*result.badge);
    [self deliver:out why:result.why];
}

- (void)serviceExtensionTimeWillExpire {
    [self deliver:[self genericContent] why:"time expired"];
}

@end
