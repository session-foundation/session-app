// The media source registry's forgetter. Built and run by `pnpm --filter @session/bridge-rn
// test:native`: nothing here needs JSI, Nitro or libsession.

#include "MediaSource.hpp"

#include <cstdio>
#include <cstdlib>
#include <thread>

namespace {

int failures = 0;

#define CHECK(condition)                                                                   \
    do {                                                                                   \
        if (!(condition)) {                                                                \
            std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition); \
            failures++;                                                                    \
        }                                                                                  \
    } while (0)

void forgets_nothing_until_a_loader_says_how() {
    session_bridge_rn::set_media_forgetter(nullptr);
    session_bridge_rn::forget_media();
}

void runs_the_forgetter_set_last() {
    int first = 0, second = 0;
    session_bridge_rn::set_media_forgetter([&] { first++; });
    session_bridge_rn::set_media_forgetter([&] { second++; });
    session_bridge_rn::forget_media();
    CHECK(first == 0);
    CHECK(second == 1);
    session_bridge_rn::set_media_forgetter(nullptr);
}

// A discard runs on whichever thread handled it, not the one the loader was made on.
void forgets_from_another_thread() {
    int forgotten = 0;
    session_bridge_rn::set_media_forgetter([&] { forgotten++; });
    std::thread{session_bridge_rn::forget_media}.join();
    CHECK(forgotten == 1);
    session_bridge_rn::set_media_forgetter(nullptr);
}

// Run outside the registry lock, so a forgetter that asks for the source cannot deadlock.
void lets_the_forgetter_use_the_registry() {
    bool asked = false;
    session_bridge_rn::set_media_forgetter([&] {
        static_cast<void>(session_bridge_rn::media_source());
        asked = true;
    });
    session_bridge_rn::forget_media();
    CHECK(asked);
    session_bridge_rn::set_media_forgetter(nullptr);
}

}  // namespace

int main() {
    forgets_nothing_until_a_loader_says_how();
    runs_the_forgetter_set_last();
    forgets_from_another_thread();
    lets_the_forgetter_use_the_registry();
    if (failures == 0)
        std::puts("MediaSource: all passed");
    return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
