#pragma once

#include "MediaSource.hpp"

#include <atomic>
#include <functional>
#include <memory>

namespace session_bridge_rn {

/// A media source JavaScript answers: the fake, which has no Client.
///
/// **Nothing JavaScript owns leaves the JS thread.** A loader calls from its own thread; the
/// request is posted to the JS thread, where `ask_*` calls into JavaScript and its answer, bytes
/// copied, reaches the handler. Every call is answered exactly once, with an error when the JS
/// thread is gone or the source closes first.
class JsMediaSource final : public MediaSource, public std::enable_shared_from_this<JsMediaSource> {
  public:
    /// Runs `job` on the JS thread, or returns false when there is no longer one to run it on.
    using OnJs = std::function<bool(std::function<void()> job)>;
    /// Called on the JS thread only; answers `cb` from any thread, once.
    using AskMedia =
            std::function<void(double message_id, double index, ::session_bridge::MediaHandler cb)>;
    using AskThumbhash = std::function<void(
            double message_id, double index, ::session_bridge::ThumbhashHandler cb)>;

    /// A thumbnail is asked like a file: JPEG bytes, typed `image/jpeg`.
    JsMediaSource(
            OnJs on_js, AskMedia ask_media, AskThumbhash ask_thumbhash, AskMedia ask_thumbnail) :
            _on_js{std::move(on_js)},
            _ask_media{std::move(ask_media)},
            _ask_thumbhash{std::move(ask_thumbhash)},
            _ask_thumbnail{std::move(ask_thumbnail)} {}

    void fetch_media(double message_id, double index, ::session_bridge::MediaHandler cb) override;
    void fetch_thumbhash(
            double message_id, double index, ::session_bridge::ThumbhashHandler cb) override;
    void fetch_thumbnail(
            double message_id, double index, ::session_bridge::MediaHandler cb) override;

    /// **On the JS thread**, so the functions holding JavaScript values are released there. Answers
    /// everything pending, and every call after.
    void close();

  private:
    OnJs _on_js;
    AskMedia _ask_media;
    AskThumbhash _ask_thumbhash;
    AskMedia _ask_thumbnail;
    std::atomic<bool> _closed = false;
    std::shared_ptr<PendingAnswers> _pending = std::make_shared<PendingAnswers>();
};

}  // namespace session_bridge_rn
