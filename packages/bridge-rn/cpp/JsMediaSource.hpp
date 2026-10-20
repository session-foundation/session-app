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
    using AskPreview = std::function<void(
            double message_id, double index, ::session_bridge::PreviewHandler cb)>;

    JsMediaSource(OnJs on_js, AskMedia ask_media, AskPreview ask_preview) :
            _on_js{std::move(on_js)},
            _ask_media{std::move(ask_media)},
            _ask_preview{std::move(ask_preview)} {}

    void fetch_media(double message_id, double index, ::session_bridge::MediaHandler cb) override;
    void fetch_preview(
            double message_id, double index, ::session_bridge::PreviewHandler cb) override;

    /// **On the JS thread**, so the functions holding JavaScript values are released there. Answers
    /// everything pending, and every call after.
    void close();

  private:
    OnJs _on_js;
    AskMedia _ask_media;
    AskPreview _ask_preview;
    std::atomic<bool> _closed = false;
    std::shared_ptr<PendingAnswers> _pending = std::make_shared<PendingAnswers>();
};

}  // namespace session_bridge_rn
