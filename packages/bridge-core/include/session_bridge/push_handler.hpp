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
    /// iOS opens its database with SQLite's header in plaintext (see the bridge); Android does not.
    bool plaintext_header = false;
};

/// Handles one push with a Client of its own: opens the database one-shot, attaches a one-shot
/// network, hands the push to `handle_push`, and closes everything before returning. For a process
/// in which the app's own Client is not open: never beside it, since two Clients in one process on
/// one database would each think they own it.
///
/// Never throws: a database that will not open, or a push that cannot be handled, comes back as a
/// generic notification, since the person has a message and should hear about it.
PushResult handle_cold_push(
        const ColdPush& where,
        std::string_view enc_payload,
        std::string_view you,
        std::chrono::milliseconds deadline,
        const PushLog& log);

}  // namespace session_bridge
