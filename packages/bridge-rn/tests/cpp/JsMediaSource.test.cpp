// The JavaScript-backed media source, with a thread standing in for the JS thread. Built and run by
// `pnpm --filter @session/bridge-rn test:native`: nothing here needs JSI, Nitro or libsession.

#include "JsMediaSource.hpp"

#include <atomic>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <deque>
#include <functional>
#include <future>
#include <mutex>
#include <thread>
#include <vector>

using session_bridge_rn::JsMediaSource;

namespace {

int failures = 0;

#define CHECK(condition)                                                                   \
    do {                                                                                   \
        if (!(condition)) {                                                                \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition); \
            failures++;                                                                    \
        }                                                                                  \
    } while (0)

/// One thread draining a queue, as the JS thread drains its dispatcher's.
class FakeJsThread {
  public:
    FakeJsThread() : _thread{[this] { run(); }} {}
    ~FakeJsThread() { stop(); }

    bool post(std::function<void()> job) {
        std::lock_guard lock{_mutex};
        if (_stopped)
            return false;
        _jobs.push_back(std::move(job));
        _wake.notify_one();
        return true;
    }

    /// Runs `job` there and waits for it, as JavaScript calling into native would.
    void run_now(std::function<void()> job) {
        std::promise<void> done;
        post([&] {
            job();
            done.set_value();
        });
        done.get_future().wait();
    }

    /// Waits until every job posted so far has run.
    void drain() { run_now([] {}); }

    void stop() {
        {
            std::lock_guard lock{_mutex};
            if (_stopped)
                return;
            _stopped = true;
            _wake.notify_one();
        }
        _thread.join();
    }

    std::thread::id id() const { return _thread.get_id(); }

  private:
    void run() {
        for (;;) {
            std::function<void()> job;
            {
                std::unique_lock lock{_mutex};
                _wake.wait(lock, [&] { return _stopped || !_jobs.empty(); });
                if (_jobs.empty())
                    return;
                job = std::move(_jobs.front());
                _jobs.pop_front();
            }
            job();
        }
    }

    std::mutex _mutex;
    std::condition_variable _wake;
    std::deque<std::function<void()>> _jobs;
    bool _stopped = false;
    std::thread _thread;
};

/// Counts answers per call, so "exactly once" can be checked rather than assumed.
struct Tally {
    std::mutex mutex;
    std::vector<int> answers;
    std::vector<bool> ok;

    size_t open(size_t count) {
        std::lock_guard lock{mutex};
        answers.assign(count, 0);
        ok.assign(count, false);
        return count;
    }
    void record(size_t at, bool succeeded) {
        std::lock_guard lock{mutex};
        answers[at]++;
        ok[at] = succeeded;
    }
};

void wait_until(const std::function<bool()>& done) {
    for (int i = 0; i < 2000 && !done(); i++)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
}

JsMediaSource::OnJs posting_to(FakeJsThread& js) {
    return [&js](std::function<void()> job) { return js.post(std::move(job)); };
}

/// Answers from JavaScript that already has the bytes, before any loader could subscribe - the
/// case where a promise has settled by the time its listener is added.
void answers_that_are_already_there_are_read_on_the_js_thread() {
    FakeJsThread js;
    std::atomic<int> asked_elsewhere = 0;
    auto source = std::make_shared<JsMediaSource>(
            posting_to(js),
            [&](double, double, session_bridge::MediaHandler cb) {
                if (std::this_thread::get_id() != js.id())
                    asked_elsewhere++;
                cb(session_bridge::Media{std::nullopt, "image/jpeg", {std::byte{0xff}}});
            },
            [&](double, double, session_bridge::PreviewHandler cb) {
                if (std::this_thread::get_id() != js.id())
                    asked_elsewhere++;
                cb(session_bridge::Preview{std::nullopt, 1, 1, std::vector<std::byte>(4)});
            });

    Tally tally;
    tally.open(2);
    std::thread loader{[&] {
        source->fetch_media(1, 0, [&](session_bridge::Media m) { tally.record(0, !m.error); });
        source->fetch_preview(1, 0, [&](session_bridge::Preview p) { tally.record(1, !p.error); });
    }};
    loader.join();
    js.drain();

    CHECK(asked_elsewhere == 0);
    CHECK(tally.answers[0] == 1 && tally.ok[0]);
    CHECK(tally.answers[1] == 1 && tally.ok[1]);
    js.run_now([&] { source->close(); });
}

/// Many loader threads asking for the same picture and its preview at once, answered both at once
/// and later, as a grid scrolled fast asks.
void concurrent_fetches_of_one_ref_are_each_answered_once() {
    FakeJsThread js;
    std::atomic<int> asked_elsewhere = 0;
    std::vector<session_bridge::PreviewHandler> later;
    auto source = std::make_shared<JsMediaSource>(
            posting_to(js),
            [&](double, double, session_bridge::MediaHandler cb) {
                if (std::this_thread::get_id() != js.id())
                    asked_elsewhere++;
                cb(session_bridge::Media{std::nullopt, "image/jpeg", {std::byte{1}}});
            },
            [&](double, double, session_bridge::PreviewHandler cb) {
                if (std::this_thread::get_id() != js.id())
                    asked_elsewhere++;
                later.push_back(std::move(cb));
            });

    constexpr size_t THREADS = 8;
    constexpr size_t EACH = 250;
    Tally media;
    Tally previews;
    media.open(THREADS * EACH);
    previews.open(THREADS * EACH);
    std::vector<std::thread> loaders;
    for (size_t t = 0; t < THREADS; t++)
        loaders.emplace_back([&, t] {
            for (size_t i = 0; i < EACH; i++) {
                const size_t at = t * EACH + i;
                source->fetch_media(7, 0, [&, at](session_bridge::Media m) {
                    media.record(at, !m.error);
                });
                source->fetch_preview(7, 0, [&, at](session_bridge::Preview p) {
                    previews.record(at, !p.error);
                });
            }
        });
    for (auto& loader : loaders)
        loader.join();
    js.drain();
    js.run_now([&] {
        for (auto& cb : later)
            cb(session_bridge::Preview{std::nullopt, 1, 1, std::vector<std::byte>(4)});
        // A second answer to the same call, which a JS promise cannot give but a bug here could.
        for (auto& cb : later)
            cb(session_bridge::Preview{std::nullopt, 1, 1, std::vector<std::byte>(4)});
    });

    CHECK(asked_elsewhere == 0);
    for (size_t at = 0; at < THREADS * EACH; at++) {
        CHECK(media.answers[at] == 1 && media.ok[at]);
        CHECK(previews.answers[at] == 1 && previews.ok[at]);
    }
    js.run_now([&] { source->close(); });
}

/// A load JavaScript never answers is answered by close(), and an answer arriving after is dropped.
void closing_answers_what_is_pending_and_everything_after() {
    FakeJsThread js;
    std::vector<session_bridge::MediaHandler> never;
    bool released_on_js = false;
    struct Probe {
        FakeJsThread* js;
        bool* released_on_js;
        ~Probe() { *released_on_js = std::this_thread::get_id() == js->id(); }
    };
    auto probe = std::make_shared<Probe>(Probe{&js, &released_on_js});
    auto source = std::make_shared<JsMediaSource>(
            posting_to(js),
            [&, probe](double, double, session_bridge::MediaHandler cb) {
                never.push_back(std::move(cb));
            },
            [](double, double, session_bridge::PreviewHandler) {});
    probe.reset();

    Tally tally;
    tally.open(3);
    source->fetch_media(1, 0, [&](session_bridge::Media m) { tally.record(0, !m.error); });
    js.drain();
    js.run_now([&] { source->close(); });
    js.run_now([&] {
        for (auto& cb : never)
            cb(session_bridge::Media{std::nullopt, "image/jpeg", {std::byte{1}}});
    });
    source->fetch_media(1, 0, [&](session_bridge::Media m) { tally.record(1, !m.error); });
    source->fetch_preview(1, 0, [&](session_bridge::Preview p) { tally.record(2, !p.error); });

    CHECK(tally.answers[0] == 1 && !tally.ok[0]);
    CHECK(tally.answers[1] == 1 && !tally.ok[1]);
    CHECK(tally.answers[2] == 1 && !tally.ok[2]);
    // What held JavaScript values was released on the JS thread, by close().
    CHECK(released_on_js);
}

/// A reload tears the JS thread down: a load then fails rather than waiting for ever.
void a_js_thread_that_has_gone_fails_the_load() {
    FakeJsThread js;
    auto source = std::make_shared<JsMediaSource>(
            posting_to(js),
            [](double, double, session_bridge::MediaHandler) {},
            [](double, double, session_bridge::PreviewHandler) {});
    js.stop();
    Tally tally;
    tally.open(1);
    source->fetch_media(1, 0, [&](session_bridge::Media m) { tally.record(0, !m.error); });
    wait_until([&] { return tally.answers[0] > 0; });
    CHECK(tally.answers[0] == 1 && !tally.ok[0]);
}

/// A reload can quit the JS queue between a job being accepted and run: the job is dropped, and
/// the load is answered by close(), which the old instance's destructor runs.
void a_job_accepted_and_dropped_is_answered_once_by_close() {
    auto source = std::make_shared<JsMediaSource>(
            [](std::function<void()>) { return true; },
            [](double, double, session_bridge::MediaHandler) {},
            [](double, double, session_bridge::PreviewHandler) {});
    Tally tally;
    tally.open(2);
    source->fetch_media(1, 0, [&](session_bridge::Media m) { tally.record(0, !m.error); });
    source->fetch_preview(1, 0, [&](session_bridge::Preview p) { tally.record(1, !p.error); });
    CHECK(tally.answers[0] == 0 && tally.answers[1] == 0);
    source->close();
    CHECK(tally.answers[0] == 1 && !tally.ok[0]);
    CHECK(tally.answers[1] == 1 && !tally.ok[1]);
}

/// The registry is one per process, so what a would-be source refuses on is who is registered,
/// not what the HybridObject asking happens to hold.
void the_registry_says_whether_another_source_is_serving() {
    using session_bridge_rn::media_served_by_another;
    auto make = [] {
        return std::make_shared<JsMediaSource>(
                [](std::function<void()>) { return true; },
                [](double, double, session_bridge::MediaHandler) {},
                [](double, double, session_bridge::PreviewHandler) {});
    };
    auto mine = make();
    auto other = make();
    CHECK(!media_served_by_another(nullptr));
    session_bridge_rn::set_media_source(mine);
    CHECK(!media_served_by_another(mine.get()));
    CHECK(media_served_by_another(other.get()));
    CHECK(media_served_by_another(nullptr));
    // A source closing late cannot unset the one that replaced it.
    session_bridge_rn::clear_media_source(other.get());
    CHECK(media_served_by_another(nullptr));
    session_bridge_rn::clear_media_source(mine.get());
    CHECK(!media_served_by_another(nullptr));
}

}  // namespace

int main() {
    answers_that_are_already_there_are_read_on_the_js_thread();
    concurrent_fetches_of_one_ref_are_each_answered_once();
    closing_answers_what_is_pending_and_everything_after();
    a_js_thread_that_has_gone_fails_the_load();
    a_job_accepted_and_dropped_is_answered_once_by_close();
    the_registry_says_whether_another_source_is_serving();
    if (failures == 0)
        std::puts("JsMediaSource: all passed");
    return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
