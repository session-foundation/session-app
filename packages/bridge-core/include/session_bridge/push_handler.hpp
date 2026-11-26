#pragma once

#include <array>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <optional>
#include <session/push/notifications.hpp>
#include <string>
#include <string_view>
#include <vector>

namespace session::client {
class Client;
}

namespace session_bridge {

/// What one push comes to: what to post, if anything, and what to take down.
///
/// The same for every platform, so that the Android push service and the iOS notification extension
/// differ only in how they open the database and how they draw a notification.
struct PushResult {
    /// The notification to post, already claimed: only this process posts it. Nullopt for nothing
    /// to show; the platform shows nothing, or a generic notification where it must show something.
    std::optional<session::push::NotificationContent> show;
    /// Identifiers of notifications posted earlier whose messages have since been read or deleted.
    std::vector<std::string> stale;
    /// The unread count, for a badge, when it could be read.
    std::optional<int64_t> badge;
    /// What happened, in words for the log: never message content.
    std::string why;
    /// The message `show` is about, which tapping it lands on: set for a message the Client keeps.
    std::optional<int64_t> message_id;
};

/// How long handling a push may take before it ends with whatever it has: inside iOS's 30 seconds
/// for a notification extension and Android's 20 for `onMessageReceived`, with room to open and
/// close the database and post.
inline constexpr std::chrono::milliseconds PUSH_DEADLINE{15'000};

using PushLog = std::function<void(std::string_view)>;

/// A notification for a push that could not be handled: "You've got a new message."
session::push::NotificationContent generic_notification();

/// Handles one push on a Client that is already open: decodes and receives it, decides what to
/// show, claims it and lists what to take down. Blocks until done or `deadline` has passed, so it
/// must not be called on the Client's own loop.
///
/// `you` is the user's own word for themselves, in their language, which a mention of them becomes.
/// `open` is the conversation on screen, as its string id, which gets no notification; nullopt
/// while the app is not in front.
PushResult handle_push(
        session::client::Client& client,
        session::push::Notifications& notifications,
        std::string_view enc_payload,
        std::string_view you,
        std::optional<std::string_view> open,
        std::chrono::milliseconds deadline,
        const PushLog& log);

/// Where a push opens the database when the app is not running.
struct ColdPush {
    std::filesystem::path db_path;
    std::array<std::byte, 32> key;
    /// "mainnet": the push server watches mainnet's swarms only, so no other network subscribes,
    /// and any other is refused.
    std::string netid = "mainnet";
    /// How long to keep trying to open a database another process has locked. iOS's app holds it
    /// for up to its close's interrupt deadline after leaving the screen, and the extension waits
    /// that out rather than showing a generic notification.
    std::chrono::milliseconds open_retry_for{0};
    /// The conversation on screen in the app, which gets no notification; see `handle_push`.
    std::optional<std::string> open;
};

/// Handles one push with a Client of its own: opens the database one-shot, attaches a one-shot
/// network, hands the push to `handle_push`, and closes everything before returning. For a process
/// in which the app's own Client is not open: never beside it, since two Clients in one process on
/// one database would each think they own it.
///
/// `deadline` is the whole of it, opening included: what opening took comes out of the time left to
/// handle the push.
///
/// Never throws: a database that will not open, or a push that cannot be handled, comes back as a
/// generic notification, since the person has a message and should hear about it.
PushResult handle_cold_push(
        const ColdPush& where,
        std::string_view enc_payload,
        std::string_view you,
        std::chrono::milliseconds deadline,
        const PushLog& log);

/// How long before the horizon a message may be stamped and still be announced: a message carries
/// the moment its sender pressed send, by its sender's clock. A message claimed already is not
/// announced twice.
inline constexpr std::chrono::minutes ARRIVAL_SKEW{5};

/// A notification to post for a message that arrived while the app runs, and the message.
struct ArrivalNotification {
    session::push::NotificationContent content;
    int64_t message_id;
};

/// What to post for messages that arrived while the app runs, on a Client already open:
/// libsession's decision (`Notifications::decide`) for each incoming message stamped after
/// `horizon` less ARRIVAL_SKEW, which claims it, so that a push for the same message shows nothing.
///
/// The horizon is when this device first had the account, and never moves: what is older is the
/// history a restore fetches, and is not announced. Not when messages were last taken in, which
/// would silence a message sent just before a poll, or one whose sender's send was slow or retried
/// and so arrives long after the moment it carries. Blocks: never on the Client's own loop.
std::vector<ArrivalNotification> decide_arrivals(
        session::push::Notifications& notifications,
        const std::vector<session::client::Message>& arrived,
        std::string_view you,
        std::chrono::sys_time<std::chrono::milliseconds> horizon);

/// What has changed for notifications already shown, after read state may have: those to take
/// down, as `Notifications::stale` reports them, and the badge.
struct NotificationRefresh {
    std::vector<std::string> stale;
    int64_t badge = 0;
};

/// Blocks: never on the Client's own loop.
NotificationRefresh refresh_notifications(
        session::client::Client& client, session::push::Notifications& notifications);

/// What a notification's button asks for: its conversation marked read, or a reply sent there.
struct NotificationAction {
    /// The conversation, as its string id: a message notification's thread.
    std::string conversation;
    /// The reply to send, or nullopt to mark read only.
    std::optional<std::string> reply;
    /// Whether to mark the conversation read: always for Mark read, and for a reply unless a newer
    /// notification of the conversation is still up, so that the rest can be answered one by one.
    bool mark_read = true;
};

struct ActionResult {
    /// Done: marked read, and for a reply, the reply accepted by the swarm.
    bool done = false;
    /// What happened, in words for the log: never message content.
    std::string why;
    /// Notifications to take down now that the conversation is read: the one acted on and any
    /// other of its messages', as `Notifications::stale` reports them.
    std::vector<std::string> stale;
};

/// How long a notification's action may take, inside what either OS lets a process run for once
/// it has been woken for one.
inline constexpr std::chrono::milliseconds ACTION_DEADLINE{20'000};

/// Carries out a notification's action on a Client already open, waiting for a reply to reach the
/// swarm until `deadline`, and reports what it made stale: the caller takes those down itself,
/// since a process woken only for the action may be frozen before anything else would. Blocks:
/// never on the Client's own loop.
ActionResult handle_action(
        session::client::Client& client,
        session::push::Notifications& notifications,
        const NotificationAction& action,
        std::chrono::milliseconds deadline,
        const PushLog& log);

/// The same with a Client of its own, opened and closed as `handle_cold_push` does: for a process
/// in which the app's own Client is not open, never beside it. Never throws.
ActionResult handle_cold_action(
        const ColdPush& where,
        const NotificationAction& action,
        std::chrono::milliseconds deadline,
        const PushLog& log);

}  // namespace session_bridge
