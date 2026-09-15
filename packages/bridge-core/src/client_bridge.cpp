#include "session_bridge/client_bridge.hpp"

#include <session/client.hpp>
#include <session/client/conversation.hpp>
#include <session/client/conversation_id.hpp>
#include <session/core/devices.hpp>
#include <session/logging.hpp>
#include <session/mnemonics.hpp>
#include <session/network/network_opt.hpp>
#include <session/network/session_network.hpp>
#include <session/sqlite.hpp>

#include <oxenc/hex.h>

#ifdef SESSION_BRIDGE_TESTING
#include <SessionProtos.pb.h>

#include <session/config/namespaces.hpp>
#include <session/core/swarm_message.hpp>
#include <session/session_protocol.hpp>
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstring>
#include <filesystem>
#include <functional>
#include <limits>
#include <ranges>
#include <stdexcept>
#include <utility>
#include <variant>
#include <vector>

#include "convert.hpp"

namespace session_bridge {

// libsession's own names, which a flat namespace does not bring into scope on its own.
using namespace ::session;

namespace {

    /// libsession reports "no such thing" as an empty optional rather than an error, and the two
    /// mean different things to a caller. Said once here so every command spells it the same way.
    std::string not_found(std::string_view what, const std::string& id) {
        return std::string{what} + " " + id + " does not exist";
    }

    /// A number from JavaScript as a whole number of type T, or an error naming the field.
    ///
    /// Every numeric field crosses as a double, and `static_cast` to an integer type is undefined
    /// behaviour when the value does not fit - NaN, an infinity, or anything past the range. A
    /// caller that sends one gets a Response with an error rather than whatever the cast produced.
    /// The ceiling is 2^53 for the wide types, which is where a double stops naming one integer.
    template <typename T>
    T whole(double value, std::string_view what) {
        static constexpr double exact = 9007199254740992.0;  // 2^53
        static constexpr double lo =
                std::max(static_cast<double>(std::numeric_limits<T>::lowest()), -exact);
        static constexpr double hi =
                std::min(static_cast<double>(std::numeric_limits<T>::max()), exact);

        if (!std::isfinite(value) || value != std::trunc(value) || value < lo || value > hi)
            throw std::invalid_argument{
                    std::string{what} + " must be a whole number this bridge can carry"};
        return static_cast<T>(value);
    }

    /// What a devnet polls at, in place of libsession's 20 seconds.
    ///
    /// Short enough that a message arrives while somebody is still looking at the screen, and far
    /// enough above zero that the polls do not overlap: nothing serialises them, so an interval
    /// below a round trip gets concurrent requests rather than faster ones.
    constexpr auto DEVNET_POLL_INTERVAL = std::chrono::milliseconds{500};

    LogLevel log_level_of(std::string_view name) {
        return name == "trace"      ? LogLevel::trace
             : name == "debug"      ? LogLevel::debug
             : name == "info"       ? LogLevel::info
             : name == "error"      ? LogLevel::error
             : name == "critical"   ? LogLevel::critical
                                    : LogLevel::warn;
    }

    /// The bytes a hex field names, or an error naming the field.
    ///
    /// oxenc::from_hex is undefined behaviour on anything but an even-length run of hex digits:
    /// its own assert is gone from a release build, and its decoder then reads pairs straight
    /// past the end of the input. Every hex field here arrives from JavaScript, so the length
    /// and the alphabet are checked before decoding rather than after.
    std::string hex_bytes(std::string_view hex, size_t bytes, std::string_view what) {
        if (hex.size() != bytes * 2 || !oxenc::is_hex(hex))
            throw std::invalid_argument{
                    std::string{what} + " must be " + std::to_string(bytes) + " bytes of hex"};
        return oxenc::from_hex(hex);
    }

    /// libsession's seed records from the app's, or an error naming the one that is wrong.
    ///
    /// Every message names the index and the field, because a seed list comes from a launch
    /// configuration and libsession's refusals name neither: a bad key throws out of `from_hex`
    /// and a host name where an address belongs throws out of libquic, both far below anything
    /// that knows this was the second entry's `ip`.
    std::vector<network::service_node> service_nodes(const std::vector<SeedNode>& seeds) {
        std::vector<network::service_node> nodes;
        nodes.reserve(seeds.size());

        for (size_t i = 0; i < seeds.size(); i++) {
            const auto& seed = seeds[i];
            const auto where = "seedNodes[" + std::to_string(i) + "].";

            auto key = network::ed25519_pubkey::maybe_from_hex(seed.ed25519_pubkey_hex);
            if (!key)
                throw std::invalid_argument{where + "ed25519PubkeyHex must be 64 hex characters"};

            std::optional<oxen::quic::ipv4> ip;
            try {
                ip = oxen::quic::ipv4{seed.ip};
            } catch (const std::exception&) {
                throw std::invalid_argument{
                        where + "ip must be an IPv4 address, not \"" + seed.ip +
                        "\": libsession dials it and resolves no host names"};
            }

            nodes.push_back(network::service_node{
                    *key,
                    *ip,
                    whole<uint16_t>(seed.https_port, where + "httpsPort"),
                    whole<uint16_t>(seed.omq_port, where + "omqPort"),
                    // What the built-in seeds are declared with. Nothing reads it: the first cache
                    // refresh replaces these with nodes that report their own version.
                    {2, 11, 0},
                    network::swarm::INVALID_SWARM_ID});
        }

        return nodes;
    }

    /// Everything a Network is built from, or nothing when there is none to build.
    ///
    /// Assembled whole before anything is replaced, so a configuration that does not hold up
    /// leaves the client on whatever it had.
    std::optional<std::vector<network::opt::any>> plan_network(
            const NetworkOptions& network, const std::filesystem::path& db_path) {
        if (network.netid.empty())
            return std::nullopt;

        const bool devnet = network.netid == "devnet";
        if (!devnet && network.netid != "mainnet" && network.netid != "testnet")
            throw std::invalid_argument{
                    "netid must be mainnet, testnet or devnet, not \"" + network.netid + "\""};

        std::vector<network::opt::any> opts;

        if (devnet) {
            // netid::devnet refuses an empty list too, from a constructor that does not know the
            // list came from an option called seedNodes.
            if (network.seed_nodes.empty())
                throw std::invalid_argument{
                        "devnet needs at least one seed node: libsession has built-in seeds for "
                        "mainnet and testnet only"};
            opts.emplace_back(network::opt::netid::devnet(service_nodes(network.seed_nodes)));
        } else if (network.netid == "testnet")
            opts.emplace_back(network::opt::netid::testnet());
        else
            opts.emplace_back(network::opt::netid::mainnet());

        // Session Router has no devnet: it refuses one outright, and the router library's own
        // netid knows the two public networks only. Onion requests reach the same swarms, which is
        // why a devnet defaults to them and cannot be moved off them.
        const bool session_router =
                network.router ? *network.router == RouterKind::session_router : !devnet;
        if (devnet && session_router)
            throw std::invalid_argument{
                    "router must be onion-requests on a devnet: Session Router has no devnet"};
        opts.emplace_back(
                session_router ? network::opt::router::session_router()
                               : network::opt::router::onion_requests());

        // A devnet is usually one machine, and path building will not put two nodes from a /24 in
        // one path - so left enforced it builds no paths at all and every request times out.
        if (devnet)
            opts.emplace_back(network::opt::disable_subnet_diversity{});

        if (network.file_server) {
            const auto& fs = *network.file_server;
            if (fs.host.empty())
                throw std::invalid_argument{"fileServer.host must not be empty"};
            if (fs.x25519_pubkey_hex.size() != 64 || !oxenc::is_hex(fs.x25519_pubkey_hex))
                throw std::invalid_argument{
                        "fileServer.x25519PubkeyHex must be 64 hex characters: the server's "
                        "X25519 key, not the Ed25519 one its QUIC endpoint is named by"};

            opts.emplace_back(network::opt::file_server_scheme{
                    std::string{EnumTraits<UrlScheme>::to_string(fs.scheme)}});
            opts.emplace_back(network::opt::file_server_host{fs.host});
            opts.emplace_back(network::opt::file_server_port{
                    whole<uint16_t>(fs.port, "fileServer.port")});
            opts.emplace_back(network::opt::file_server_pubkey_hex{fs.x25519_pubkey_hex});
        }

        // Beside the database rather than in it: freeing space works by unlinking what the
        // directory holds that nothing accounts for, so this cannot share with anything else.
        opts.emplace_back(network::opt::cache_directory{db_path.parent_path() / "netcache"});

        return opts;
    }

}  // namespace

struct ClientBridge::Impl {
    Sink sink;
    std::unique_ptr<client::Client> client;
    InitOptions options;
    session::LoggerHandle logger;

    explicit Impl(Sink s, InitOptions o) : sink{std::move(s)}, options{std::move(o)} {}

    /// What this client tells the account's other devices it is.
    ///
    /// Called on every start rather than once: `update_info` compares the user-settable fields
    /// itself and returns without touching the seqno when they match. Which does mean it has to
    /// be built from things that do not vary between launches - anything read from the clock or
    /// the environment would republish this device to the account on every run.
    void publish_device_info() {
        using core::device::Type;
        auto type = options.device_type == "ios"       ? Type::Session_iOS
                    : options.device_type == "android" ? Type::Session_Android
                    : options.device_type == "desktop" ? Type::Session_Desktop
                                                       : Type::Unknown;
        if (type == Type::Unknown)
            return;

        auto info = client->core.devices.device_info().first;
        info.type = type;
        // Ignored for a known type, but it is what we would have been stored as before that type
        // existed, and leaving it set keeps a stale string in the record.
        info.other_device.clear();
        client->core.devices.update_info(info);
    }

    /// Gives Core a way off the machine. Idempotent enough to call whenever an account appears:
    /// make_network replaces whatever was attached.
    void attach_network() {
        // Judged before the account is, so that a network nothing can attach to is refused by
        // whoever supplied it. Onboarding is exactly the case with no account yet, and one
        // accepted here would instead be thrown by the createAccount that brings it into being.
        auto planned = plan_network(options.network, options.db_path);
        if (!planned || !client->core.globals.have_account())
            return;

        client->core.make_network(network::config::Config{*planned});

        // A devnet is a handful of nodes on one machine with nothing else talking to them, so
        // libsession's 20-second default is all latency and no saving. Decided here rather than
        // configured, for the same reason the router and subnet diversity are: on a devnet it is
        // not a choice anyone would make differently. An app that wants another value can still
        // call setPollInterval, which runs after this.
        if (options.network.netid == "devnet")
            client->core.set_poll_interval(DEVNET_POLL_INTERVAL);
    }

    /// Both halves of "an account now exists", which is what onboarding signals too. The record
    /// is published whether or not there is a network to push it over, since being offline stops
    /// the push rather than the fact.
    void on_account() {
        publish_device_info();
        attach_network();
    }

    /// The only path frames take out of here. Moved, never copied: the adapter's queue takes
    /// ownership on Core's loop and the JavaScript object is built from it on the JS thread.
    void emit(Frame frame) {
        if (!sink)
            return;
        sink(std::move(frame));
    }

    void event(SessionEvent e) {
        emit(EventFrame{std::move(e)});
    }

    void respond(double id, Result result) {
        emit(ResponseFrame{Response{id, std::nullopt, std::move(result)}});
    }

    void ok(double id) {
        respond(id, EmptyResult{});
    }

    void fail(double id, std::string_view message) {
        emit(ResponseFrame{Response{id, std::string{message}, std::nullopt}});
    }

    /// Wraps a handler so that the error leg is written once rather than at every call site.
    /// `failable_function`'s leading error argument is the whole convention, and forgetting to
    /// check it is the one mistake it exists to prevent.
    template <typename F>
    auto on(double id, F&& f) {
        return [this, id, f = std::forward<F>(f)](std::optional<std::string> error, auto&&... rest) {
            if (error) {
                fail(id, *error);
                return;
            }
            // Client::_dispatch_out only logs what escapes a handler, so an uncaught throw here
            // is a request that never gets a Response. setNickname on note to self is one.
            try {
                f(std::forward<decltype(rest)>(rest)...);
            } catch (const std::exception& e) {
                fail(id, e.what());
            }
        };
    }

    /// By value, because every caller was handed the list by libsession and is done with it:
    /// the strings move into the frame instead of being copied a second time.
    static std::vector<Conversation> conversations(std::vector<client::AnyConversation> from) {
        std::vector<Conversation> out;
        out.reserve(from.size());
        for (auto& c : from)
            out.push_back(to_bridge(std::move(c)));
        return out;
    }

    void conversation_list(double id, std::vector<client::AnyConversation> convos) {
        respond(id, ConversationListResult{conversations(std::move(convos))});
    }

    void one_conversation(double id, client::AnyConversation convo) {
        respond(id, ConversationResult{to_bridge(std::move(convo))});
    }

    client::Conversation convo(const std::string& id) {
        return client::Conversation{*client, client::ConversationId::parse(id)};
    }

    /// One transfer report, on the stream, whoever asked for it.
    ///
    /// Taken by const reference and copied out of: libsession lends a progress payload rather than
    /// giving it, because the same one is reported against repeatedly.
    void attachment_progress(
            AttachmentTransfer transfer,
            const client::ConversationId& convo_id,
            const client::AttachmentProgress& p) {
        event(AttachmentProgressSessionEvent{
                transfer,
                convo_id.to_string(),
                static_cast<double>(p.message_id),
                static_cast<double>(p.index),
                static_cast<double>(p.done),
                static_cast<double>(p.total),
                p.result ? std::optional<double>{static_cast<double>(*p.result)} : std::nullopt});
    }

    /// The progress handler a command passes libsession, which reports to the stream rather than
    /// to the request: a transfer outlives the tap that started it, and the row that draws it may
    /// not have existed when it began.
    std::function<void(const client::AttachmentProgress&)> report(
            AttachmentTransfer transfer, client::ConversationId convo_id) {
        return [this, transfer, convo_id = std::move(convo_id)](
                       const client::AttachmentProgress& p) {
            attachment_progress(transfer, convo_id, p);
        };
    }

    // One handler per command. Dispatch is a std::visit over the Command variant, so a command
    // added to @session/bridge-types that has no handler here is a compile error, not a request
    // that quietly falls through.

    void handle(double id, const GetAccountInfoCommand&) {
        // The first call the app makes, and on a fresh install there is no account: asking for a
        // display name then is asking a question about an account that does not exist.
        if (!client->core.globals.have_account()) {
            respond(id, AccountInfoResult{AccountInfo{false, std::nullopt, std::nullopt, false}});
            return;
        }
        client->display_name(on(id, [this, id](std::string name) {
            std::optional<std::string> display_name;
            if (!name.empty())
                display_name = std::move(name);
            respond(id,
                    AccountInfoResult{AccountInfo{
                            true,
                            client->core.globals.session_id_hex(),
                            std::move(display_name),
                            client->core.network() != nullptr}});
        }));
    }

    void handle(double id, const CreateAccountCommand&) {
        client->core.globals.create_account();
        on_account();
        ok(id);
    }

    void handle(double id, const SetDisplayNameCommand& cmd) {
        client->set_display_name(cmd.name, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const RestoreAccountFromSeedCommand& cmd) {
        auto raw = hex_bytes(cmd.hex_seed, 32, "hexSeed");
        b32 seed;
        std::memcpy(seed.data(), raw.data(), seed.size());
        client->core.globals.restore_account(core::predefined_seed{std::span{seed}});
        on_account();
        ok(id);
    }

    void handle(double id, const RestoreAccountFromWordsCommand& cmd) {
        std::vector<std::string_view> words;
        words.reserve(cmd.words.size());
        for (const auto& word : cmd.words)
            words.emplace_back(word);
        client->core.globals.restore_account(
                cmd.language ? core::predefined_seed{words, *cmd.language}
                             : core::predefined_seed{words});
        on_account();
        ok(id);
    }

    void handle(double id, const GetSeedMnemonicCommand& cmd) {
        auto words = client->core.globals.seed_mnemonic(
                cmd.language ? std::string_view{*cmd.language} : std::string_view{"English"});
        std::vector<std::string> out;
        // The span must outlive the loop: it holds the accessor that keeps the secure buffer
        // unlocked, and iterating over a temporary re-locks it before the body runs.
        auto opened = words.open();
        for (const auto& word : opened)
            out.emplace_back(word);
        respond(id, MnemonicResult{std::move(out)});
    }

    void handle(double id, const AttachNetworkCommand& cmd) {
        // attach_network throws on a network it will not attach to, so the whole config is put
        // back on that path. Left set, a refused one is what every later on_account() -
        // onboarding's, in particular - would throw on without being asked to.
        NetworkOptions wanted{
                cmd.netid,
                cmd.seed_nodes.value_or(std::vector<SeedNode>{}),
                cmd.file_server,
                cmd.router};
        auto previous = std::exchange(options.network, std::move(wanted));
        try {
            attach_network();
        } catch (...) {
            options.network = std::move(previous);
            throw;
        }
        ok(id);
    }

    void handle(double id, const SetPollIntervalCommand& cmd) {
        auto ms = whole<int64_t>(cmd.interval_ms, "setPollInterval.intervalMs");
        // Core reads a non-positive interval as "as fast as the loop will go" rather than
        // refusing it, which is a busy loop against the swarm.
        if (ms <= 0)
            throw std::invalid_argument{"setPollInterval.intervalMs must be greater than zero"};
        client->core.set_poll_interval(std::chrono::milliseconds{ms});
        ok(id);
    }

    void handle(double id, const PollOnceCommand&) {
        // Core owns its poll ticker and exposes no one-shot entry point. Asking for one is the
        // first of the background-and-push questions in docs/STATUS.md; until it is answered
        // there is nothing honest to call here.
        fail(id, "pollOnce is not supported by this libsession build");
    }

    void handle(double id, const SetPushTokenCommand&) {
        fail(id, "setPushToken is not implemented by the bridge yet");
    }

    void handle(double id, const HandlePushPayloadCommand&) {
        fail(id, "handlePushPayload is not implemented by the bridge yet");
    }

    void handle(double id, const GetConversationsCommand&) {
        client->conversations(on(id, [this, id](std::vector<client::AnyConversation> convos) {
            conversation_list(id, std::move(convos));
        }));
    }

    void handle(double id, const GetMessageRequestsCommand&) {
        client->message_requests(on(id, [this, id](std::vector<client::AnyConversation> convos) {
            conversation_list(id, std::move(convos));
        }));
    }

    void handle(double id, const GetConversationCommand& cmd) {
        const auto convo_id = cmd.conversation_id;
        client->conversation(
                client::ConversationId::parse(convo_id),
                on(id, [this, id, convo_id](std::optional<client::AnyConversation> convo) {
                    if (!convo)
                        fail(id, not_found("conversation", convo_id));
                    else
                        one_conversation(id, std::move(*convo));
                }));
    }

    void handle(double id, const OpenDmCommand& cmd) {
        const auto session_id = cmd.session_id;
        client->open_dm(
                client::ConversationId::parse(session_id),
                on(id, [this, id, session_id](std::optional<client::DM> dm) {
                    if (!dm)
                        fail(id, not_found("account", session_id));
                    else
                        one_conversation(id, client::AnyConversation{std::move(*dm)});
                }));
    }

    void handle(double id, const MarkReadCommand& cmd) {
        std::optional<sys_ms> up_to;
        if (cmd.up_to)
            up_to = from_epoch_ms(whole<int64_t>(*cmd.up_to, "markRead.upTo"));
        convo(cmd.conversation_id).mark_read(up_to, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const SetBlockedCommand& cmd) {
        client->set_blocked(
                client::ConversationId::parse(cmd.conversation_id),
                cmd.blocked,
                on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const SetPriorityCommand& cmd) {
        convo(cmd.conversation_id)
                .set_priority(
                        whole<int>(cmd.priority, "setPriority.priority"),
                        on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const SetNicknameCommand& cmd) {
        const auto convo_id = cmd.conversation_id;
        const auto nickname = cmd.nickname.value_or("");
        client->dm(
                client::ConversationId::parse(convo_id),
                on(id, [this, id, convo_id, nickname](std::optional<client::DM> dm) {
                    if (!dm)
                        fail(id, not_found("conversation", convo_id));
                    else
                        dm->set_nickname(nickname, on(id, [this, id] { ok(id); }));
                }));
    }

    void handle(double id, const ApproveConversationCommand&) {
        // There is no such call, by design: libsession records approval from messages flowing,
        // and writing to someone is what approves them (see DM::request). A conversation-layer
        // way to accept a request without answering it is one of the open questions in
        // docs/STATUS.md.
        fail(id,
             "approveConversation has no libsession counterpart: approval is recorded by "
             "sending, not set");
    }

    void handle(double id, const DeleteConversationCommand& cmd) {
        convo(cmd.conversation_id)
                .delete_conversation(cmd.keep_messages, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const GetMessagesCommand& cmd) {
        std::optional<client::MessageCursor> before;
        if (cmd.before)
            before = client::MessageCursor{
                    from_epoch_ms(whole<int64_t>(cmd.before->timestamp, "getMessages.before.timestamp")),
                    whole<int64_t>(cmd.before->id, "getMessages.before.id")};
        convo(cmd.conversation_id)
                .messages(
                        whole<int>(cmd.limit, "getMessages.limit"),
                        before,
                        cmd.include_deleted,
                        on(id, [this, id](std::vector<client::Message> messages) {
                            std::vector<Message> out;
                            out.reserve(messages.size());
                            // libsession answers newest first, because that is the direction
                            // paging runs. The protocol is oldest first, because that is the
                            // direction a transcript is read, and reversing once here is cheaper
                            // than every caller remembering to.
                            for (auto& m : std::views::reverse(messages))
                                out.push_back(to_bridge(std::move(m)));
                            respond(id, MessageListResult{std::move(out)});
                        }));
    }

    // Not const: the request is this call's to consume, so the body moves.
    void handle(double id, SendMessageCommand& cmd) {
        client::OutgoingMessage msg;
        msg.body = std::move(cmd.body);
        if (cmd.reply_to)
            msg.reply_to = whole<int64_t>(*cmd.reply_to, "sendMessage.replyTo");
        convo(cmd.conversation_id)
                .send_message(std::move(msg), on(id, [this, id](int64_t message_id) {
                                  respond(id, MessageIdResult{static_cast<double>(message_id)});
                              }));
    }

    void handle(double id, const RetrySendCommand& cmd) {
        const int64_t message_id = whole<int64_t>(cmd.message_id, "retrySend.messageId");
        // The callback form takes an upload handler and there is no overload without one, so it
        // is passed empty - which libsession reads as "report nothing" rather than calling a
        // handler with an empty body. Nothing about a transfer crosses this bridge.
        client->retry_send(
                message_id,
                nullptr,
                on(id, [this, id](bool started) { respond(id, BoolResult{started}); }));
    }

    void handle(double id, const DeleteMessageCommand& cmd) {
        auto answer = on(id, [this, id](bool deleted) { respond(id, BoolResult{deleted}); });
        const int64_t message_id = whole<int64_t>(cmd.message_id, "deleteMessage.messageId");
        // No default label, so -Werror=switch makes a new Deletion value a build failure here
        // rather than one that silently deletes locally. See session_bridge_strict_switches.
        switch (cmd.scope) {
            case Deletion::everywhere:
                client->delete_message_everywhere(message_id, std::move(answer));
                break;
            case Deletion::here:
                client->delete_message(message_id, std::move(answer));
                break;
        }
    }

    void handle(double id, const DownloadAttachmentCommand& cmd) {
        const int64_t message_id = whole<int64_t>(cmd.message_id, "downloadAttachment.messageId");
        const auto index = whole<size_t>(cmd.index, "downloadAttachment.index");
        // Looked up for its conversation, which the progress reports carry and this command does
        // not: libsession's AttachmentProgress names the message and not the conversation.
        client->message(message_id, on(id, [this, id, message_id, index](
                                              std::optional<client::Message> msg) {
            if (!msg)
                fail(id, not_found("message", std::to_string(message_id)));
            else
                // The bytes are dropped: this is the call that *fills* the cache, and filling it
                // is the whole of what the command does. What reads the file is the media scheme.
                client->attachment_data(
                        message_id,
                        index,
                        report(AttachmentTransfer::download, msg->conversation),
                        on(id, [this, id](std::vector<std::byte>) { ok(id); }));
        }));
    }

    void handle(double id, const SaveAttachmentCommand& cmd) {
        const int64_t message_id = whole<int64_t>(cmd.message_id, "saveAttachment.messageId");
        const auto index = whole<size_t>(cmd.index, "saveAttachment.index");
        const std::filesystem::path dest{cmd.destination};
        const bool notify = cmd.notify_sender, replace = cmd.replace;
        client->message(
                message_id,
                on(id,
                   [this, id, message_id, index, dest, notify, replace](
                           std::optional<client::Message> msg) {
                       if (!msg)
                           fail(id, not_found("message", std::to_string(message_id)));
                       else
                           client->save_attachment(
                                   message_id,
                                   index,
                                   dest,
                                   report(AttachmentTransfer::save, msg->conversation),
                                   on(id,
                                      [this, id](std::filesystem::path saved_to) {
                                          respond(id, PathResult{saved_to.string()});
                                      }),
                                   notify,
                                   replace);
                   }));
    }

    void handle(double id, const SetAutoDownloadCommand& cmd) {
        client::AutoDownload mode = client::AutoDownload::none;
        // No default label: -Werror=switch makes a new mode a build failure rather than one that
        // silently downloads nothing.
        switch (cmd.mode) {
            case AutoDownload::none: mode = client::AutoDownload::none; break;
            case AutoDownload::image_attachments:
                mode = client::AutoDownload::image_attachments;
                break;
            case AutoDownload::all: mode = client::AutoDownload::all; break;
        }
        convo(cmd.conversation_id).set_auto_download(mode, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const GetCacheDirCommand&) {
        respond(id, PathResult{options.cache_dir.string()});
    }

    void handle(double id, const GetAttachmentCacheLimitCommand&) {
        client->attachment_cache_limit(on(id, [this, id](std::optional<int64_t> bytes) {
            respond(id,
                    ByteCountResult{
                            bytes ? std::optional<double>{static_cast<double>(*bytes)}
                                  : std::nullopt});
        }));
    }

    void handle(double id, const SetAttachmentCacheLimitCommand& cmd) {
        std::optional<int64_t> bytes;
        if (cmd.bytes)
            bytes = whole<int64_t>(*cmd.bytes, "setAttachmentCacheLimit.bytes");
        client->set_attachment_cache_limit(bytes, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const GetPrefCommand& cmd) {
        respond(id, PrefResult{client->core.globals.get_text(cmd.key)});
    }

    void handle(double id, const SetPrefCommand& cmd) {
        client->core.globals.set(cmd.key, cmd.value);
        ok(id);
    }

    // The test-only commands are part of the protocol on every build, so that the fake and the
    // TypeScript can name them; only a SESSION_BRIDGE_TESTING build serves them.

    void handle(double id, [[maybe_unused]] const GetTestAccountSeedCommand& cmd) {
#ifdef SESSION_BRIDGE_TESTING
        // Named, because the accessor is what holds the secure buffer readable and the rvalue
        // overloads are deleted precisely to stop this being a one-liner.
        auto access = client->core.globals.account_seed();
        auto raw = access.seed();
        respond(id, HexResult{oxenc::to_hex(std::as_bytes(std::span{raw}))});
#else
        fail(id, "getTestAccountSeed is only served by a SESSION_BRIDGE_TESTING build");
#endif
    }

    void handle(double id, [[maybe_unused]] const DeliverTestMessageCommand& cmd) {
#ifdef SESSION_BRIDGE_TESTING
        auto seed = hex_bytes(cmd.sender_seed_hex, 32, "senderSeedHex");

        const int64_t timestamp = whole<int64_t>(cmd.timestamp, "deliverTestMessage.timestamp");
        const auto sent = from_epoch_ms(timestamp);

        SessionProtos::Content content;
        content.set_sigtimestamp(static_cast<uint64_t>(timestamp));
        content.mutable_datamessage()->set_body(cmd.body);
        auto plaintext = content.SerializeAsString();

        b33 recipient;
        std::ranges::copy(client->core.globals.session_id(), recipient.begin());

        auto encoded = encode_dm_v1(
                std::as_bytes(std::span{plaintext}),
                ed25519::PrivKeySpan::from(std::as_bytes(std::span{seed})),
                sent,
                recipient);

        // The hash is the swarm's, and a redelivered one is how libsession recognises a
        // duplicate - so it has to be stable for a message and different between messages.
        core::SwarmMessage message{
                encoded,
                "test-" + std::to_string(timestamp) + "-" +
                        std::to_string(std::hash<std::string>{}(cmd.body)),
                sent,
                from_epoch_ms(timestamp + 14 * 24 * 60 * 60 * 1000)};

        // Onto Core's loop, because the connection pool is single-threaded by design and this
        // is the one place the bridge writes the database from outside it.
        client->core.loop().call_get([&] {
            client->core.receive_messages({&message, 1}, config::Namespace::Default, true);
            return 0;
        });
        ok(id);
#else
        fail(id, "deliverTestMessage is only served by a SESSION_BRIDGE_TESTING build");
#endif
    }

    void handle(double id, [[maybe_unused]] const ApproveTestContactCommand& cmd) {
#ifdef SESSION_BRIDGE_TESTING
        auto decoded = hex_bytes(cmd.session_id, 33, "sessionId");
        b33 sid;
        std::memcpy(sid.data(), decoded.data(), sid.size());
        client->core.loop().call_get([&] {
            auto conn = client->core.database().conn();
            conn.prepared_exec("INSERT OR IGNORE INTO accounts (session_id) VALUES (?)", sid);
            conn.prepared_exec(
                    "INSERT INTO contacts (account, approved) VALUES ("
                    "(SELECT id FROM accounts WHERE session_id = ?), 1) "
                    "ON CONFLICT (account) DO UPDATE SET approved = 1",
                    sid);
            return 0;
        });
        ok(id);
#else
        fail(id, "approveTestContact is only served by a SESSION_BRIDGE_TESTING build");
#endif
    }

    void handle(double id, [[maybe_unused]] EchoTestFrameCommand& cmd) {
#ifdef SESSION_BRIDGE_TESTING
        // Straight back out, then the acknowledgement: what arrived through the platform's
        // from-JS converter leaves through its to-JS converter, field for field.
        emit(std::move(cmd.frame));
        ok(id);
#else
        fail(id, "echoTestFrame is only served by a SESSION_BRIDGE_TESTING build");
#endif
    }

    void dispatch(Request& request) {
        std::visit([&](auto& cmd) { handle(request.id, cmd); }, request.command);
    }
};

ClientBridge::ClientBridge(InitOptions options, Sink sink) :
        _impl{std::make_unique<Impl>(std::move(sink), options)} {

    auto* impl = _impl.get();

    // Every handler does the same two things and nothing else: fill a frame, and hand it to the
    // sink. That is what makes running them inline on Core's loop correct rather than merely
    // convenient.
    client::callbacks cbs{
            .conversation_added =
                    [impl](client::AnyConversation c) {
                        impl->event(ConversationAddedSessionEvent{to_bridge(std::move(c))});
                    },
            .conversation_updated =
                    [impl](client::AnyConversation c) {
                        impl->event(ConversationUpdatedSessionEvent{to_bridge(std::move(c))});
                    },
            .conversation_removed =
                    [impl](const client::ConversationId& id) {
                        impl->event(ConversationRemovedSessionEvent{id.to_string()});
                    },
            .conversation_list_replaced =
                    [impl](std::vector<client::AnyConversation> convos) {
                        impl->event(ConversationListReplacedSessionEvent{
                                Impl::conversations(std::move(convos))});
                    },
            .request_list_replaced =
                    [impl](std::vector<client::AnyConversation> convos) {
                        impl->event(RequestListReplacedSessionEvent{
                                Impl::conversations(std::move(convos))});
                    },
            .message_added =
                    [impl](const client::ConversationId& id, client::Message m) {
                        impl->event(
                                MessageAddedSessionEvent{id.to_string(), to_bridge(std::move(m))});
                    },
            .message_updated =
                    [impl](const client::ConversationId& id, client::Message m) {
                        impl->event(
                                MessageUpdatedSessionEvent{id.to_string(), to_bridge(std::move(m))});
                    },
            .history_replaced =
                    [impl](const client::ConversationId& id) {
                        impl->event(HistoryReplacedSessionEvent{id.to_string()});
                    },
            .attachment_progress =
                    [impl](const client::ConversationId& convo_id,
                           const client::AttachmentProgress& p) {
                        // Background fetches only: a transfer a command started reports through
                        // the handler that command passed, and both land on the same stream.
                        impl->attachment_progress(AttachmentTransfer::download, convo_id, p);
                    },
            // display_picture_progress is deliberately left unset: no screen draws a display
            // picture yet, so there is nothing a report would feed.
    };

    // The key options are types rather than values, so which one is used has to be a branch
    // rather than an argument. Only one of these ever runs, which is what makes moving the
    // callbacks in each of them safe.
    auto open = [&](auto&&... key) {
        if (options.defer_account)
            return std::make_unique<client::Client>(
                    options.db_path,
                    std::move(cbs),
                    core::defer_account{},
                    std::forward<decltype(key)>(key)...);
        return std::make_unique<client::Client>(
                options.db_path, std::move(cbs), std::forward<decltype(key)>(key)...);
    };

    if (options.raw_key)
        _impl->client = open(sqlite::raw_key{*options.raw_key});
    else if (options.password)
        _impl->client = open(sqlite::argon2id_password{*options.password});
    else
        _impl->client = open();

    if (!options.cache_dir.empty())
        _impl->client->set_cache_dir(options.cache_dir);

    // Set up after the Client exists, so nothing arrives before there is a sink to take it.
    if (!options.log_level.empty() || !options.log_categories.empty()) {
        if (!options.log_level.empty())
            logger_reset_level(log_level_of(options.log_level));

        // After the default, because reset_level sets every existing category: the other order
        // would hand each override straight back to the level it was overriding.
        for (const auto& each : options.log_categories)
            logger_set_level(each.category, log_level_of(each.level));

        // Kept so close() can take it back off: this fires from threads close() cannot join,
        // and what it writes to does not outlive the bridge.
        impl->logger =
                add_logger([impl](std::string_view message,
                                  std::string_view category,
                                  LogLevel lvl) {
                    impl->event(LogSessionEvent{
                            std::string{message},
                            std::string{category},
                            std::string{lvl.to_string()}});
                });
    }

    // An account that is already there needs no onboarding, so this is where its network comes
    // from. A deferred one gets it from createAccount or restoreAccount instead.
    _impl->on_account();
}

ClientBridge::~ClientBridge() {
    close();
}

void ClientBridge::close() {
    if (!_impl)
        return;
    // Order matters. remove_logger is serialised against logging, so once it returns the callback
    // is neither running nor reachable; destroying the Client then joins Core's loop, so nothing
    // is mid-emit by the time the Impl the two of them write to goes.
    remove_logger(_impl->logger);
    _impl->client.reset();
    _impl.reset();
}

void ClientBridge::call(Request request) {
    if (!_impl || !_impl->client)
        return;

    try {
        _impl->dispatch(request);
    } catch (const std::exception& e) {
        // Validation throws on the calling thread: ConversationId::parse on a malformed id, a
        // reply_to naming a message in another conversation. Those are answers to this request,
        // not bridge failures.
        _impl->fail(request.id, e.what());
    }
}

}  // namespace session_bridge
