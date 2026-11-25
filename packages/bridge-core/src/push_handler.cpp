#include <session_bridge/push_handler.hpp>

#include <condition_variable>
#include <memory>
#include <mutex>
#include <thread>
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

    /// Why `where` cannot be opened, or nullopt when it can be tried.
    std::optional<std::string> unopenable(const ColdPush& where) {
        if (where.netid != "mainnet" && where.netid != "testnet")
            return "no push handling on " + where.netid;
        std::error_code ec;
        if (!std::filesystem::exists(where.db_path, ec))
            return "no database";
        return std::nullopt;
    }

    /// A Client of its own on `where`, one-shot, with a one-shot network attached. Throws when the
    /// database will not open.
    std::unique_ptr<client::Client> open_cold(const ColdPush& where, const PushLog& log) {
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
        if (where.netid == "testnet")
            client->core.make_network(
                    session::network::opt::netid::testnet(),
                    session::network::opt::router::session_router(),
                    session::network::opt::cache_directory{cache},
                    session::network::opt::one_shot{});
        else
            client->core.make_network(
                    session::network::opt::netid::mainnet(),
                    session::network::opt::router::session_router(),
                    session::network::opt::cache_directory{cache},
                    session::network::opt::one_shot{});
        return client;
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
    if (auto why = unopenable(where))
        return generic(*why);
    try {
        auto client = open_cold(where, log);
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

std::vector<push::NotificationContent> decide_arrivals(
        push::Notifications& notifications,
        const std::vector<client::Message>& arrived,
        std::string_view you,
        std::chrono::sys_time<std::chrono::milliseconds> horizon) {
    std::vector<push::NotificationContent> shown;
    for (const auto& m : arrived) {
        if (m.outgoing || m.timestamp <= horizon - ARRIVAL_SKEW)
            continue;
        if (auto n = notifications.decide({push::Handled::received, std::nullopt, m}, you))
            shown.push_back(std::move(*n));
    }
    return shown;
}

NotificationRefresh refresh_notifications(
        client::Client& client, push::Notifications& notifications) {
    return {notifications.stale(), client.badge_count(session::await)};
}

ActionResult handle_action(
        client::Client& client,
        const NotificationAction& action,
        std::chrono::milliseconds deadline,
        const PushLog& log) {
    const auto until = std::chrono::steady_clock::now() + deadline;
    auto id = client::ConversationId::parse(action.conversation);
    if (!client.conversation(id, session::await))
        return {false, "no such conversation"};
    client::Conversation{client, id}.mark_read(session::await);
    log("marked read");
    if (!action.reply)
        return {true, "marked read"};

    auto sent = client.send_message(
            id, client::OutgoingMessage{.body = *action.reply}, session::await);
    // Watched until it has gone: the process may be suspended or ended as soon as this returns.
    while (std::chrono::steady_clock::now() < until) {
        auto m = client.message(sent, session::await);
        auto state = m ? m->send_state : std::nullopt;
        if (state == client::SendState::sent)
            return {true, "reply sent"};
        if (state && *state != client::SendState::pending && *state != client::SendState::sending)
            return {false, "reply failed to send"};
        std::this_thread::sleep_for(200ms);
    }
    return {false, "reply still sending at the deadline"};
}

ActionResult handle_cold_action(
        const ColdPush& where,
        const NotificationAction& action,
        std::chrono::milliseconds deadline,
        const PushLog& log) {
    if (auto why = unopenable(where))
        return {false, *why};
    try {
        auto client = open_cold(where, log);
        auto out = handle_action(*client, action, deadline, log);
        client.reset();
        log("database closed");
        return out;
    } catch (const std::exception& e) {
        return {false, std::string{"threw: "} + e.what()};
    }
}

}  // namespace session_bridge
