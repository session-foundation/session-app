#include <session_bridge/push_handler.hpp>

#include <condition_variable>
#include <memory>
#include <mutex>
#include <session/client.hpp>
#include <session/client/conversation_id.hpp>
#include <session/network/network_opt.hpp>
#include <session/network/session_network.hpp>
#include <session/sqlite.hpp>
#include <utility>

using namespace std::literals;
namespace push = session::push;
namespace client = session::client;

namespace session_bridge {

namespace {

    std::string_view outcome_name(push::Handled h) {
        switch (h) {
            case push::Handled::received: return "received";
            case push::Handled::fetched: return "fetched";
            case push::Handled::nothing_to_do: return "nothing to do";
            case push::Handled::not_found: return "not found";
            case push::Handled::fetch_failed: return "fetch failed";
            case push::Handled::unreadable: return "unreadable";
            case push::Handled::not_ours: return "not ours";
            case push::Handled::undecryptable: return "undecryptable";
            case push::Handled::malformed: return "malformed";
        }
        return "unknown";
    }

    PushResult generic(std::string why) {
        return {generic_notification(), {}, std::nullopt, std::move(why)};
    }

}  // namespace

push::NotificationContent generic_notification() {
    push::NotificationContent c;
    c.kind = push::NotificationContent::Kind::generic;
    c.id = push::Notifications::GENERIC_ID;
    c.thread = push::Notifications::GENERIC_ID;
    return c;
}

PushResult handle_push(
        client::Client& client,
        push::Notifications& notifications,
        std::string_view enc_payload,
        std::string_view you,
        std::optional<std::string_view> open,
        std::chrono::milliseconds deadline,
        const PushLog& log) {
    std::optional<client::ConversationId> on_screen;
    if (open)
        on_screen = client::ConversationId::parse(*open);
    // Shared with the callback, which can run after a timeout has given up on it.
    struct Wait {
        std::mutex m;
        std::condition_variable cv;
        std::optional<session::Expected<push::HandledPush>> result;
    };
    auto wait = std::make_shared<Wait>();
    notifications.handle(enc_payload, deadline, [wait](session::Expected<push::HandledPush> r) {
        std::lock_guard lock{wait->m};
        wait->result.emplace(std::move(r));
        wait->cv.notify_one();
    });

    PushResult out;
    {
        std::unique_lock lock{wait->m};
        // handle() ends itself at the deadline; the margin is for its callback to arrive.
        if (!wait->cv.wait_for(lock, deadline + 2s, [&] { return wait->result.has_value(); }))
            out = generic("handling the push timed out");
        else if (!*wait->result)
            out = generic("handling the push failed: " + wait->result->error().message);
        else {
            const auto& handled = **wait->result;
            log("handled: " + std::string{outcome_name(handled.outcome)});
            out.show = notifications.decide(handled, you, on_screen);
            out.why = out.show ? "shown" : "nothing to show";
        }
    }
    out.stale = notifications.stale();
    out.badge = client.badge_count(session::await);
    return out;
}

PushResult handle_cold_push(
        const ColdPush& where,
        std::string_view enc_payload,
        std::string_view you,
        std::chrono::milliseconds deadline,
        const PushLog& log) {
    // The push server watches mainnet's swarms only, so nothing else subscribes.
    if (where.netid != "mainnet")
        return generic("no push handling on " + where.netid);
    std::error_code ec;
    if (!std::filesystem::exists(where.db_path, ec))
        return generic("no database");
    try {
        auto client = where.plaintext_header
                            ? std::make_unique<client::Client>(
                                      where.db_path,
                                      session::sqlite::raw_key{where.key},
                                      session::sqlite::plaintext_header,
                                      session::core::one_shot{})
                            : std::make_unique<client::Client>(
                                      where.db_path,
                                      session::sqlite::raw_key{where.key},
                                      session::core::one_shot{});
        log("database open");
        const auto cache = where.db_path.parent_path() / "netcache";
        client->core.make_network(
                session::network::opt::netid::mainnet(),
                session::network::opt::router::session_router(),
                session::network::opt::cache_directory{cache},
                session::network::opt::one_shot{});
        PushResult out;
        {
            push::Notifications notifications{*client};
            out = handle_push(
                    *client, notifications, enc_payload, you, std::nullopt, deadline, log);
        }
        client.reset();
        log("database closed");
        return out;
    } catch (const std::exception& e) {
        return generic(std::string{"threw: "} + e.what());
    }
}

}  // namespace session_bridge
