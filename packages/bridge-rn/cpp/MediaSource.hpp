#pragma once

#include <session_bridge/client_bridge.hpp>

#include <cstdint>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <variant>

// Not under margelo::nitro::session: a name starting `session` would be looked up there first.
namespace session_bridge_rn {

/// What the native image loaders ask for an attachment's bytes, whoever answers.
///
/// A handler may run on any thread - Core's loop for libsession, the JS thread for a JavaScript
/// source - and must only hand its answer on. Every call is answered exactly once, with an error
/// when the source closes first.
class MediaSource {
  public:
    virtual ~MediaSource() = default;
    virtual void fetch_media(
            double message_id, double index, ::session_bridge::MediaHandler cb) = 0;
    virtual void fetch_thumbhash(
            double message_id, double index, ::session_bridge::ThumbhashHandler cb) = 0;
    virtual void fetch_thumbnail(
            double message_id, double index, ::session_bridge::MediaHandler cb) = 0;
};

/// The source the loaders use, or null to fail every load. Takes the place of the one before.
void set_media_source(std::shared_ptr<MediaSource> source);

/// A copy of the current source: holding it is what keeps a load safe from `close()`.
std::shared_ptr<MediaSource> media_source();

/// Clears the registration only if it is still `source`, so a source closing late cannot unset
/// the one that replaced it.
void clear_media_source(const MediaSource* source);

/// Whether a source other than `mine` is registered. The registry is one per process and a bridge
/// is one per HybridObject, so this, not a member, is what a would-be source must refuse on.
bool media_served_by_another(const MediaSource* mine);

/// What empties this platform's loader of every picture it has decoded. Set by the loader, once
/// it exists; may run on any thread.
void set_media_forgetter(std::function<void()> forget);

/// Runs the loader's forgetter, if one is set: a discard has replaced the database, whose message
/// ids start again at 1, so every URL cached before it names some other message now.
void forget_media();

/// The handlers a source has handed out and not yet answered, so closing can answer them.
class PendingAnswers : public std::enable_shared_from_this<PendingAnswers> {
  public:
    using Handler = std::variant<::session_bridge::MediaHandler, ::session_bridge::ThumbhashHandler>;

    /// Wraps `cb` so it runs at most once, whether the answer or `fail_all` gets there first.
    ::session_bridge::MediaHandler track(::session_bridge::MediaHandler cb);
    ::session_bridge::ThumbhashHandler track(::session_bridge::ThumbhashHandler cb);

    /// Answers everything still pending with `error`.
    void fail_all(const std::string& error);

  private:
    std::optional<Handler> take(uint64_t id);

    std::mutex _mutex;
    uint64_t _next = 0;
    std::unordered_map<uint64_t, Handler> _handlers;
};

/// libsession as a media source, for as long as its `ClientBridge` is open.
class BridgeMediaSource final : public MediaSource {
  public:
    explicit BridgeMediaSource(::session_bridge::ClientBridge& bridge) : _bridge{&bridge} {}

    void fetch_media(double message_id, double index, ::session_bridge::MediaHandler cb) override;
    void fetch_thumbhash(
            double message_id, double index, ::session_bridge::ThumbhashHandler cb) override;
    void fetch_thumbnail(
            double message_id, double index, ::session_bridge::MediaHandler cb) override;

    /// Refuses every call from here on, waiting out any call still starting. **Before** the
    /// `ClientBridge` is destroyed, which is what makes the pointer safe to use under the lock.
    void detach();

    /// Answers what the closed bridge dropped. **After** it is destroyed, which joins Core's loop,
    /// so no answer can still be on its way.
    void fail_pending();

  private:
    std::shared_mutex _mutex;
    ::session_bridge::ClientBridge* _bridge;
    std::shared_ptr<PendingAnswers> _pending = std::make_shared<PendingAnswers>();
};

}  // namespace session_bridge_rn
