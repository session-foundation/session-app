#include <session_bridge/notification_sound.hpp>

#include <array>
#include <utility>

namespace session_bridge {

namespace {

    // Legacy iOS's `Preferences.Sound` raw values.
    constexpr std::array<std::pair<NotificationSound, std::int64_t>, 13> STORED{{
            {NotificationSound::aurora, 1000},
            {NotificationSound::bamboo, 1001},
            {NotificationSound::chord, 1002},
            {NotificationSound::circles, 1003},
            {NotificationSound::complete, 1004},
            {NotificationSound::hello, 1005},
            {NotificationSound::input, 1006},
            {NotificationSound::keys, 1007},
            {NotificationSound::note, 1008},
            {NotificationSound::popcorn, 1009},
            {NotificationSound::pulse, 1010},
            {NotificationSound::synth, 1011},
            {NotificationSound::none, 4001},
    }};

}  // namespace

std::int64_t stored_notification_sound(NotificationSound sound) {
    for (const auto& [s, stored] : STORED)
        if (s == sound)
            return stored;
    return 1008;
}

NotificationSound notification_sound(std::int64_t stored) {
    for (const auto& [sound, n] : STORED)
        if (n == stored)
            return sound;
    return NotificationSound::note;
}

}  // namespace session_bridge
