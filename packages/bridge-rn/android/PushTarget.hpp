#pragma once

#include <chrono>
#include <optional>
#include <session_bridge/client_bridge.hpp>
#include <session_bridge/push_handler.hpp>
#include <string_view>

namespace session_bridge_rn {

/// The bridge a push is handled on while the app is running, so that it reuses the app's Client
/// rather than opening a second one on the same database. One per process, like the media source.
void set_push_bridge(::session_bridge::ClientBridge* bridge);

/// Unregisters `bridge` if it is the one registered, waiting for a push being handled on it.
void clear_push_bridge(const ::session_bridge::ClientBridge* bridge);

/// `ClientBridge::handle_push` on the registered bridge; nullopt when none is registered or it has
/// no Client open, which leaves the caller to handle the push with a Client of its own.
std::optional<::session_bridge::PushResult> handle_push_on_app_bridge(
        std::string_view enc_payload,
        std::string_view you,
        std::optional<std::string_view> open,
        std::chrono::milliseconds deadline,
        const ::session_bridge::PushLog& log);

}  // namespace session_bridge_rn
