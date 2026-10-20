#include "MediaSource.hpp"

#include <utility>

namespace session_bridge_rn {

namespace {

    std::mutex registry_mutex;
    std::shared_ptr<MediaSource> registered;
    std::function<void()> forgetter;

    template <typename Answer>
    Answer failed(const std::string& error) {
        Answer answer;
        answer.error = error;
        return answer;
    }

}  // namespace

void set_media_source(std::shared_ptr<MediaSource> source) {
    std::lock_guard lock{registry_mutex};
    registered = std::move(source);
}

std::shared_ptr<MediaSource> media_source() {
    std::lock_guard lock{registry_mutex};
    return registered;
}

void clear_media_source(const MediaSource* source) {
    std::lock_guard lock{registry_mutex};
    if (registered.get() == source)
        registered.reset();
}

bool media_served_by_another(const MediaSource* mine) {
    std::lock_guard lock{registry_mutex};
    return registered && registered.get() != mine;
}

void set_media_forgetter(std::function<void()> forget) {
    std::lock_guard lock{registry_mutex};
    forgetter = std::move(forget);
}

void forget_media() {
    std::function<void()> forget;
    {
        std::lock_guard lock{registry_mutex};
        forget = forgetter;
    }
    // Outside the lock: it calls into the platform's image pipeline, which takes locks of its own.
    if (forget)
        forget();
}

std::optional<PendingAnswers::Handler> PendingAnswers::take(uint64_t id) {
    std::lock_guard lock{_mutex};
    auto entry = _handlers.extract(id);
    if (entry.empty())
        return std::nullopt;
    return std::move(entry.mapped());
}

::session_bridge::MediaHandler PendingAnswers::track(::session_bridge::MediaHandler cb) {
    uint64_t id = 0;
    {
        std::lock_guard lock{_mutex};
        id = _next++;
        _handlers.emplace(id, std::move(cb));
    }
    // Weak, so an answer arriving after the source is gone is dropped rather than kept alive.
    return [self = weak_from_this(), id](::session_bridge::Media media) {
        if (auto pending = self.lock())
            if (auto handler = pending->take(id))
                std::get<::session_bridge::MediaHandler>(*handler)(std::move(media));
    };
}

::session_bridge::PreviewHandler PendingAnswers::track(::session_bridge::PreviewHandler cb) {
    uint64_t id = 0;
    {
        std::lock_guard lock{_mutex};
        id = _next++;
        _handlers.emplace(id, std::move(cb));
    }
    return [self = weak_from_this(), id](::session_bridge::Preview preview) {
        if (auto pending = self.lock())
            if (auto handler = pending->take(id))
                std::get<::session_bridge::PreviewHandler>(*handler)(std::move(preview));
    };
}

void PendingAnswers::fail_all(const std::string& error) {
    std::unordered_map<uint64_t, Handler> handlers;
    {
        std::lock_guard lock{_mutex};
        handlers.swap(_handlers);
    }
    // Outside the lock: a handler may start another fetch.
    for (auto& [id, handler] : handlers) {
        if (auto* media = std::get_if<::session_bridge::MediaHandler>(&handler))
            (*media)(failed<::session_bridge::Media>(error));
        else
            std::get<::session_bridge::PreviewHandler>(handler)(
                    failed<::session_bridge::Preview>(error));
    }
}

}  // namespace session_bridge_rn
