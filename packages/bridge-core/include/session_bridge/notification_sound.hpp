#pragma once

#include <session_bridge/gen/types.hpp>

#include <cstdint>

namespace session_bridge {

/// The sound as libsession's local settings store it: the number legacy iOS gave it, so that a
/// database legacy iOS wrote keeps its choice. Never zero, which the settings take to mean unset.
std::int64_t stored_notification_sound(NotificationSound sound);

/// The sound a stored number names. Unset, and any number that is not a notification sound (legacy
/// iOS numbered its ringtone and call sounds in the same space), is the default, `note`.
NotificationSound notification_sound(std::int64_t stored);

}  // namespace session_bridge
