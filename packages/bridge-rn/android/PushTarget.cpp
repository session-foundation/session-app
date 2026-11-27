#include "PushTarget.hpp"

#include <mutex>
#include <shared_mutex>

namespace session_bridge_rn {

namespace {
    std::shared_mutex push_mutex;
    ::session_bridge::ClientBridge* push_bridge = nullptr;
}  // namespace

void set_push_bridge(::session_bridge::ClientBridge* bridge) {
    std::unique_lock lock{push_mutex};
    push_bridge = bridge;
}

void clear_push_bridge(const ::session_bridge::ClientBridge* bridge) {
    std::unique_lock lock{push_mutex};
    if (push_bridge == bridge)
        push_bridge = nullptr;
}

std::optional<::session_bridge::PushResult> handle_push_on_app_bridge(
        std::string_view enc_payload,
        std::string_view you,
        std::optional<std::string_view> open,
        std::chrono::milliseconds deadline,
        const ::session_bridge::PushLog& log) {
    // Shared for the whole push, so that the bridge cannot be destroyed under it.
    std::shared_lock lock{push_mutex};
    if (!push_bridge)
        return std::nullopt;
    return push_bridge->handle_push(enc_payload, you, open, deadline, log);
}

std::optional<::session_bridge::ActionResult> act_on_app_bridge(
        const ::session_bridge::NotificationAction& action,
        std::chrono::milliseconds deadline,
        const ::session_bridge::PushLog& log) {
    std::shared_lock lock{push_mutex};
    if (!push_bridge)
        return std::nullopt;
    return push_bridge->handle_action(action, deadline, log);
}

}  // namespace session_bridge_rn
