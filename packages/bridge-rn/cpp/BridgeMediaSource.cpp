#include "MediaSource.hpp"

#include <utility>

namespace session_bridge_rn {

namespace {

    template <typename Answer>
    Answer failed(const std::string& error) {
        Answer answer;
        answer.error = error;
        return answer;
    }

}  // namespace

void BridgeMediaSource::fetch_media(
        double message_id, double index, ::session_bridge::MediaHandler cb) {
    auto tracked = _pending->track(std::move(cb));
    std::shared_lock lock{_mutex};
    if (!_bridge) {
        lock.unlock();
        tracked(failed<::session_bridge::Media>("the bridge is closed"));
        return;
    }
    _bridge->fetch_media(message_id, index, std::move(tracked));
}

void BridgeMediaSource::fetch_thumbhash(
        double message_id, double index, ::session_bridge::ThumbhashHandler cb) {
    auto tracked = _pending->track(std::move(cb));
    std::shared_lock lock{_mutex};
    if (!_bridge) {
        lock.unlock();
        tracked(failed<::session_bridge::Thumbhash>("the bridge is closed"));
        return;
    }
    _bridge->fetch_thumbhash(message_id, index, std::move(tracked));
}

void BridgeMediaSource::fetch_thumbnail(
        double message_id, double index, ::session_bridge::MediaHandler cb) {
    auto tracked = _pending->track(std::move(cb));
    std::shared_lock lock{_mutex};
    if (!_bridge) {
        lock.unlock();
        tracked(failed<::session_bridge::Media>("the bridge is closed"));
        return;
    }
    _bridge->fetch_thumbnail(message_id, index, std::move(tracked));
}

void BridgeMediaSource::detach() {
    std::unique_lock lock{_mutex};
    _bridge = nullptr;
}

void BridgeMediaSource::fail_pending() {
    _pending->fail_all("the bridge is closed");
}

}  // namespace session_bridge_rn
