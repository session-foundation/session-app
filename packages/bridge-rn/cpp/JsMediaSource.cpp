#include "JsMediaSource.hpp"

#include <string>
#include <utility>

namespace session_bridge_rn {

namespace {

    constexpr const char* CLOSED = "the bridge is closed";
    constexpr const char* NO_JS = "the JavaScript that served media has gone";

    template <typename Answer>
    Answer failed(const char* error) {
        Answer answer;
        answer.error = error;
        return answer;
    }

}  // namespace

void JsMediaSource::fetch_media(
        double message_id, double index, ::session_bridge::MediaHandler cb) {
    auto tracked = _pending->track(std::move(cb));
    if (_closed) {
        tracked(failed<::session_bridge::Media>(CLOSED));
        return;
    }
    auto job = [self = shared_from_this(), message_id, index, tracked]() mutable {
        // close() runs on this thread too, so this cannot race it.
        if (self->_closed || !self->_ask_media)
            tracked(failed<::session_bridge::Media>(CLOSED));
        else
            self->_ask_media(message_id, index, std::move(tracked));
    };
    if (!_on_js(std::move(job)))
        tracked(failed<::session_bridge::Media>(NO_JS));
}

void JsMediaSource::fetch_preview(
        double message_id, double index, ::session_bridge::PreviewHandler cb) {
    auto tracked = _pending->track(std::move(cb));
    if (_closed) {
        tracked(failed<::session_bridge::Preview>(CLOSED));
        return;
    }
    auto job = [self = shared_from_this(), message_id, index, tracked]() mutable {
        if (self->_closed || !self->_ask_preview)
            tracked(failed<::session_bridge::Preview>(CLOSED));
        else
            self->_ask_preview(message_id, index, std::move(tracked));
    };
    if (!_on_js(std::move(job)))
        tracked(failed<::session_bridge::Preview>(NO_JS));
}

void JsMediaSource::close() {
    _closed = true;
    _ask_media = nullptr;
    _ask_preview = nullptr;
    _pending->fail_all(CLOSED);
}

}  // namespace session_bridge_rn
