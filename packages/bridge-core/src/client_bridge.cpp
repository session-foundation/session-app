#include "session_bridge/client_bridge.hpp"

#include <session/client.hpp>
#include <session/client/conversation.hpp>
#include <session/client/conversation_id.hpp>
#include <session/client/error_codes.hpp>
#include <session/core/devices.hpp>
#include <session/image/source.hpp>
#include <session/image/thumbhash.hpp>
#include <session/image/thumbnail.hpp>
#include <session/logging.hpp>
#include <session/mnemonics.hpp>
#include <session/network/ip_country.hpp>
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
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <ranges>
#include <span>
#include <stdexcept>
#include <utility>
#include <variant>
#include <vector>

#include "convert.hpp"
#include "session_bridge/media_url.hpp"
#include "session_bridge/staged_thumbnails.hpp"
#include "session_bridge/utf8_path.hpp"
#include "mark_downloaded.hpp"

namespace session_bridge {

// libsession's own names, which a flat namespace does not bring into scope on its own.
using namespace ::session;

namespace {

    /// libsession reports "no such thing" as an empty optional rather than an error, and the two
    /// mean different things to a caller. Said once here so every command spells it the same way.
    std::string not_found(std::string_view what, const std::string& id) {
        return std::string{what} + " " + id + " does not exist";
    }

    /// The fake says the same sentence; the media source contract holds the two to it.
    std::string no_such_attachment(int64_t id, size_t at) {
        return not_found("attachment", std::to_string(at) + " of message " + std::to_string(id));
    }

    /// The fake says the same sentence; the media source contract holds the two to it.
    std::string no_thumbhash(int64_t id, size_t at) {
        return "attachment " + std::to_string(at) + " of message " + std::to_string(id) +
               " has no thumbhash";
    }

    /// The fake says the same sentence; the media source contract holds the two to it.
    std::string not_downloaded(int64_t id, size_t at) {
        return "attachment " + std::to_string(at) + " of message " + std::to_string(id) +
               " is not downloaded";
    }

    /// The fake says the same sentence; the media source contract holds the two to it.
    std::string no_thumbnail(int64_t id, size_t at) {
        return "attachment " + std::to_string(at) + " of message " + std::to_string(id) +
               " has no thumbnail";
    }

    std::string no_rendition(int64_t id, size_t at) {
        return "attachment " + std::to_string(at) + " of message " + std::to_string(id) +
               " has no rendition";
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

    /// Where the network's own cache lives, named once so the discard and the open agree.
    std::filesystem::path netcache_path(const std::filesystem::path& db_path) {
        return db_path.parent_path() / "netcache";
    }

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
    /// The words of a phrase, as views into the buffer that carries it.
    ///
    /// **No copies.** A `string_view` per word points into the `SecretBytes` the frame arrived in,
    /// so the phrase exists once in this process and is zeroed when that buffer goes. Building a
    /// `std::string` per word would put it back to one unwiped heap allocation each, which is most
    /// of what moving it off a JavaScript string was for.
    ///
    /// Split on a single ASCII space, because that is what the sender joined them with. Anything
    /// else it did is libsession's to reject rather than this function's to normalise.
    std::vector<std::string_view> phrase_words(const SecretBytes& phrase) {
        const auto bytes = phrase.bytes();
        const std::string_view all{reinterpret_cast<const char*>(bytes.data()), bytes.size()};
        std::vector<std::string_view> words;
        for (std::size_t at = 0; at < all.size();) {
            const auto end = all.find(' ', at);
            if (end == std::string_view::npos) {
                words.push_back(all.substr(at));
                break;
            }
            if (end > at)
                words.push_back(all.substr(at, end - at));
            at = end + 1;
        }
        return words;
    }

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
        // netid knows the two public networks only. Onion requests and direct both reach the same
        // swarms, which is why a devnet defaults to onion requests and takes either.
        const RouterKind router = network.router ? *network.router
                                : devnet          ? RouterKind::onion_requests
                                                  : RouterKind::session_router;
        if (devnet && router == RouterKind::session_router)
            throw std::invalid_argument{
                    "router must be onion-requests or direct on a devnet: Session Router has no "
                    "devnet"};
        switch (router) {
            case RouterKind::session_router:
                opts.emplace_back(network::opt::router::session_router());
                break;
            case RouterKind::onion_requests:
                opts.emplace_back(network::opt::router::onion_requests());
                break;
            case RouterKind::direct: opts.emplace_back(network::opt::router::direct()); break;
        }

        // A devnet is usually one machine, and path building will not put two nodes from a /24 in
        // one path - so left enforced it builds no paths at all and every request times out.
        if (devnet)
            opts.emplace_back(network::opt::disable_subnet_diversity{});

        if (network.file_server) {
            const auto& fs = *network.file_server;
            if (fs.host.empty())
                throw std::invalid_argument{"fileServer.host must not be empty"};
            auto key = network::ed25519_pubkey::maybe_from_hex(fs.ed25519_pubkey_hex);
            if (!key)
                throw std::invalid_argument{
                        "fileServer.ed25519PubkeyHex must be 64 hex characters: the server's "
                        "Ed25519 key, not the X25519 one"};
            // libsession converts it at every upload; converted here, a key that is no Ed25519
            // point fails the start instead. About half of X25519 keys still pass this.
            try {
                network::compute_x25519_pubkey(*key);
            } catch (const std::exception&) {
                throw std::invalid_argument{
                        "fileServer.ed25519PubkeyHex is not an Ed25519 key: the X25519 one, "
                        "perhaps"};
            }

            opts.emplace_back(network::opt::file_server_scheme{
                    std::string{EnumTraits<UrlScheme>::to_string(fs.scheme)}});
            opts.emplace_back(network::opt::file_server_host{fs.host});
            opts.emplace_back(network::opt::file_server_port{
                    whole<uint16_t>(fs.port, "fileServer.port")});
            opts.emplace_back(network::opt::file_server_pubkey_hex{fs.ed25519_pubkey_hex});
        }

        // Beside the database rather than in it: freeing space works by unlinking what the
        // directory holds that nothing accounts for, so this cannot share with anything else.
        opts.emplace_back(network::opt::cache_directory{netcache_path(db_path)});

        return opts;
    }
    /// Set while an account exists that nobody has confirmed they want to keep.
    ///
    /// Written when one is minted and erased by `keepAccount`, so its presence at startup means
    /// the last attempt did not finish -- a crash, or a kill, somewhere in the middle of it.
    constexpr std::string_view provisional_account_key = "account.provisional";

    /// `g` itself, as an expression whose type depends on `T`.
    template <typename T, typename G>
    G& dependent_on(G& g) {
        return g;
    }

    /// A send's upload reports, held until its message id is known.
    ///
    /// libsession answers `send_message` with the id once the row is stored, and its header allows
    /// a report before that answer. Every report and the answer run on Core's loop, so nothing here
    /// is shared between threads: a report before the id waits here, and the answer sends the held
    /// ones after itself, in the order they came.
    struct HeldUploads {
        struct Report {
            size_t index;
            int64_t sent;
            int64_t total;
            std::optional<Expected<void>> result;
        };

        std::optional<int64_t> message_id;
        std::vector<Report> held;
    };

}  // namespace

namespace {

    // A staged thumbnail reads its file whole on the thumbnail thread, and a phone has to afford
    // that for every tile in a tray of 32; a file past it is refused before it is read. The fake
    // holds to the same number, through the contract.
    constexpr size_t MAX_STAGED_READ_BYTES = 64 * 1024 * 1024;

    // None of these sentences names the file: the loaders log what they are refused.
    Media make_staged(const std::string& path, uint32_t edge) {
        try {
            auto bytes = read_staged_file(path, MAX_STAGED_READ_BYTES);
            if (!bytes)
                return Media{"the file could not be read", {}, {}};
            auto held = std::make_shared<std::vector<std::byte>>(*std::move(bytes));
            image::Source source{std::span<const std::byte>{*held}, held};
            auto jpeg = image::thumbnail(source, edge);
            if (!jpeg)
                return Media{"the file is not a picture", {}, {}};
            return Media{std::nullopt, "image/jpeg", *std::move(jpeg)};
        } catch (const std::exception&) {
            // Probed as a picture, then failed to decode, or ran out of memory doing it.
            return Media{"the file is not a picture", {}, {}};
        }
    }

}  // namespace

struct ClientBridge::Impl {
    Sink sink;
    std::unique_ptr<client::Client> client;
    /// Why there is no client, when the database would not open: what every request is refused
    /// with until a discard opens a fresh one. Empty while a client is open.
    std::string open_failure;
    InitOptions options;
    session::LoggerHandle logger;
    /// The network held only to fill the node cache, before there is an account to attach one.
    ///
    /// **Outlives the call that made it and is never dropped by its own callback.** `~Network`
    /// joins the loop the callback is running on, so dropping it from there deadlocks. Whatever
    /// drops it runs on another thread -- an attach, a discard, or `close`.
    std::unique_ptr<session::network::Network> warm;
    /// Where staged thumbnails are made. Shared, so a callback on Core's loop can reach it
    /// without reaching back through `this`.
    std::shared_ptr<StagedThumbnails> staged = std::make_shared<StagedThumbnails>(make_staged);
    /// Your swarm's members, for telling which of the router's paths reach it: every member can
    /// carry your traffic, and Core names the one it polls only once that one has answered. Filled
    /// by the network's swarm lookup, which answers on its own loop, so shared and locked.
    struct OwnSwarm {
        std::mutex lock;
        std::vector<::session::network::ed25519_pubkey> members;
    };
    std::shared_ptr<OwnSwarm> own_swarm = std::make_shared<OwnSwarm>();
    /// How many nodes each country holds, counted at most every `COUNTRY_RECOUNT`: the node cache
    /// changes over hours, and counting it copies every node and looks each one up.
    struct CountryCounts {
        std::mutex lock;
        std::chrono::steady_clock::time_point at{};
        std::vector<CountryNodes> counts;
    };
    static constexpr auto COUNTRY_RECOUNT = std::chrono::minutes{10};
    std::shared_ptr<CountryCounts> country_counts = std::make_shared<CountryCounts>();

    /// The node cache by country, most first; recounted while still empty, so it fills as soon as
    /// the cache does.
    std::vector<CountryNodes> nodes_by_country(::session::network::Network& net) {
        std::lock_guard l{country_counts->lock};
        auto now = std::chrono::steady_clock::now();
        if (!country_counts->counts.empty() && now - country_counts->at < COUNTRY_RECOUNT)
            return country_counts->counts;
        std::map<std::string, int, std::less<>> by_country;
        for (const auto& node : net.get_cached_nodes())
            if (auto country = ::session::ip_country::lookup(node.ip))
                ++by_country[std::string{*country}];
        std::vector<CountryNodes> counts;
        counts.reserve(by_country.size());
        for (const auto& [country, nodes] : by_country)
            counts.emplace_back(country, static_cast<double>(nodes));
        std::ranges::stable_sort(counts, std::ranges::greater{}, &CountryNodes::nodes);
        country_counts->counts = counts;
        country_counts->at = now;
        return counts;
    }
    /// Held while a network status is read and emitted, by the network's hook and by
    /// `getNetworkStatus` alike, so the two reach the stream in the order the status changed: an
    /// answer read before a change is emitted before that change's event, never after it.
    std::mutex network_status_lock;
    /// Cleared by `close` before the client goes. Destroying a Network reports `disconnected` from
    /// its destructor, which would otherwise reach a sink the adapter is tearing down.
    bool network_status_open = true;

    explicit Impl(Sink s, InitOptions o) : sink{std::move(s)}, options{std::move(o)} {}

    /// Builds the Client, and can do it again.
    ///
    /// Lifted out of the constructor because discarding an account destroys the Client and makes
    /// another: the callbacks below capture `this`, which outlives any particular Client, so they
    /// can be rebuilt as often as needed. They are moved into the Client, which is why they are
    /// constructed here on each call rather than held.
    void open_client() {
        auto* impl = this;

        // Every handler does the same two things and nothing else: fill a frame, and hand it to the
        // sink. That is what makes running them inline on Core's loop correct rather than merely
        // convenient.
        client::callbacks cbs{
                .conversation_added =
                        [impl](client::AnyConversation&& c, client::ListPlacement&& p) {
                            impl->event(ConversationAddedSessionEvent{
                                    to_bridge(std::move(c)), to_bridge(std::move(p))});
                        },
                .conversation_updated =
                        [impl](client::AnyConversation&& c, client::ListPlacement&& p) {
                            impl->event(ConversationUpdatedSessionEvent{
                                    to_bridge(std::move(c)), to_bridge(std::move(p))});
                        },
                .conversation_removed =
                        [impl](client::ConversationId&& id, client::ConversationList list) {
                            impl->event(ConversationRemovedSessionEvent{
                                    id.to_string(), to_bridge(list)});
                        },
                // No whole-list handlers. The placements above are complete on their own, and an
                // unset list handler is what spares libsession reading the whole list on every
                // change.
                // A batch, and it may span conversations: one file is one file, so fetching or
                // evicting it changes every message showing it. Each Message carries its own
                // conversation, which is why neither of these is told one.
                .messages_added =
                        [impl](std::vector<client::Message>&& ms) {
                            impl->event(MessagesAddedSessionEvent{to_bridge(std::move(ms))});
                        },
                .messages_updated =
                        [impl](std::vector<client::Message>&& ms) {
                            impl->event(MessagesUpdatedSessionEvent{to_bridge(std::move(ms))});
                        },
                .history_replaced =
                        [impl](const client::ConversationId& id) {
                            impl->event(HistoryReplacedSessionEvent{id.to_string()});
                        },
                .attachment_progress =
                        [impl](const client::ConversationId&,
                               const client::AttachmentProgress& p) {
                            // Background fetches only: a transfer a command started reports through
                            // the handler that command passed, and both land on the same stream.
                            //
                            // The conversation is dropped rather than forwarded: a command-started
                            // transfer carries only a message and an index, so a frame with this
                            // field would have it on the background reports and not on the ones
                            // every tap produces. A message id names the message either way.
                            impl->attachment_progress(AttachmentTransfer::download, p);
                        },
                // display_picture_progress is deliberately left unset: no screen draws a display
                // picture yet, so there is nothing a report would feed.
        };

        // The options are types rather than values, so which ones are used has to be a branch
        // rather than an argument. Only one of these ever runs, which is what makes moving the
        // callbacks in each of them safe.
        auto make = [&](auto&&... opts) {
            return std::make_unique<client::Client>(
                    options.db_path, std::move(cbs), std::forward<decltype(opts)>(opts)...);
        };
        auto with_edge = [&](auto&&... opts) {
            if (options.thumbnail_edge_px)
                return make(
                        client::default_thumbnail_edge{
                                whole<uint32_t>(*options.thumbnail_edge_px, "thumbnailEdgePx")},
                        std::forward<decltype(opts)>(opts)...);
            return make(std::forward<decltype(opts)>(opts)...);
        };
        auto open = [&](auto&&... key) {
            if (options.defer_account)
                return with_edge(core::defer_account{}, std::forward<decltype(key)>(key)...);
            return with_edge(std::forward<decltype(key)>(key)...);
        };

        if (options.raw_key)
            client = open(sqlite::raw_key{*options.raw_key});
        else if (options.password)
            client = open(sqlite::argon2id_password{*options.password});
        else
            client = open();

        if (!options.cache_dir.empty())
            client->set_cache_dir(options.cache_dir);

        // Set up after the Client exists, so nothing arrives before there is a sink to take it.
        if (!options.log_level.empty() || !options.log_categories.empty()) {
            if (!options.log_level.empty())
                logger_reset_level(log_level_of(options.log_level));

            // After the default, because reset_level sets every existing category: the other order
            // would hand each override straight back to the level it was overriding.
            for (const auto& each : options.log_categories)
                logger_set_level(each.category, log_level_of(each.level));

            auto* impl = this;
            // **The handle is kept, because dropping it is what leaves this registered for ever.**
            // `remove_logger` needs it to find the callback again; given a default-constructed one
            // it removes nothing, and the lambda below stays reachable with a dangling `impl`
            // after the Impl is gone. The next thing to log then calls into freed memory -- and
            // something always logs, because constructing a Core logs from its own event loop.
            //
            // Checking `sink` inside `emit` does not save it: by then `impl->` has already been
            // dereferenced, which is the fault rather than what follows it.
            //
            // Removed before it is added because this runs again on every discard: `open_client`
            // is how an account is thrown away and a fresh database opened, so without this each
            // discard would leave its predecessor registered with no handle left to reach it by.
            remove_logger(logger);
            logger = add_logger(
                    [impl](std::string_view message, std::string_view category, LogLevel lvl) {
                        // Called from whichever thread logged, including Core's loop and the
                        // network's own threads. Safe only because `close` removes it before the
                        // Impl goes, which is what the handle above is for.
                        impl->event(LogSessionEvent{
                                std::string{message},
                                std::string{category},
                                std::string{lvl.to_string()}});
                    });
        }
    }

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

        auto info = client->core.devices.device_info(session::await).first;
        info.type = type;
        // Ignored for a known type, but it is what we would have been stored as before that type
        // existed, and leaving it set keeps a stale string in the record.
        info.other_device.clear();
        client->core.devices.update_info(info, session::await);
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

        // Before the client's own, never beside it: both would refresh the same cache, and the
        // point of the warm one was to have finished by now. Blocks until its loop is joined,
        // which is also what guarantees its callback is not still holding this Impl.
        warm.reset();

        auto& net = client->core.make_network(network::config::Config{*planned});
        follow_network_status(net);

        // A devnet is a handful of nodes on one machine with nothing else talking to them, so
        // libsession's 20-second default is all latency and no saving. Decided here rather than
        // configured, for the same reason the router and subnet diversity are: on a devnet it is
        // not a choice anyone would make differently. An app that wants another value can still
        // call setPollInterval, which runs after this.
        if (options.network.netid == "devnet")
            client->core.set_poll_interval(DEVNET_POLL_INTERVAL);
    }

    /// Forwards the attached network's status as events, starting from where it is now.
    ///
    /// **Assigned after the Network exists, from this thread**, as Core assigns its own hooks
    /// beside it in `set_network`: the constructor is already connecting, and the hook is a plain
    /// member nothing can set sooner. So the status it reached before this ran is emitted here,
    /// under the same lock as the hook. A change racing the assignment can then arrive twice, which
    /// is harmless for an event that carries the whole state, and never out of order.
    ///
    /// Nothing for the warm network: it carries no account's traffic, and a dot showing it would
    /// say the app is online before it can send anything.
    void follow_network_status(session::network::Network& net) {
        auto* impl = this;
        net.on_status_changed = [impl](session::network::ConnectionStatus status) {
            std::lock_guard lock{impl->network_status_lock};
            if (impl->network_status_open)
                impl->event(NetworkStatusChangedSessionEvent{to_bridge(status)});
        };
        std::lock_guard lock{network_status_lock};
        event(NetworkStatusChangedSessionEvent{to_bridge(net.get_status())});
    }

    /// Both halves of "an account now exists", which is what onboarding signals too. The record
    /// is published whether or not there is a network to push it over, since being offline stops
    /// the push rather than the fact.
    void on_account() {
        publish_device_info();
        attach_network();
    }

    /// Marks the account about to be minted as one nobody has confirmed yet.
    ///
    /// **Called before the mint rather than after it.** `create_account` commits and then does
    /// more work outside that transaction -- establishing the device group opens transactions of
    /// its own -- so a process that dies in between leaves an account no marker describes, and
    /// the next start keeps it. That is the single thing this marker exists to prevent, and the
    /// window is not a hairline. Written first, the worst case is the harmless one: a marker with
    /// no account, which the sweep passes over because it asks whether an account exists first.
    ///
    /// **Only the paths where an application is deciding.** An account that was simply there when
    /// the database opened, or one libSession minted itself because the Core was not opened
    /// deferred, is not a decision anybody is partway through -- marking those would sweep away a
    /// working account on the next start.
    void mark_provisional() {
        // **Only where this call is the one minting.** An account already in the database belongs
        // to a decision somebody else finished, and marking it condemns it at the next start --
        // `create_account` and `restore_account` both throw on one, and the marker used to be
        // written before they got the chance to.
        //
        // Refusing here rather than unwinding afterwards, because a throw cannot say which kind it
        // was: `create_account` commits and then establishes the device group outside that
        // transaction, so a throw from there has an account *and* needs its marker kept. That is
        // the case the marker exists for.
        if (client->core.globals.have_account())
            return;
        client->core.globals.set(provisional_account_key, std::string_view{"1"});
    }

    /// Asks the whole swarm for the restored account's profile at once.
    ///
    /// **Only on the restore paths**, because only there is there something on the swarm that this
    /// device has never seen: a created account has nothing to fetch, and an account that was
    /// simply already here has its config in the database.
    ///
    /// Not waited on, and the restore does not report it. The name arrives the way any config
    /// does -- merged, then pushed to the app as state -- and the wait screen is watching the
    /// account rather than this call. Waiting would only delay the screen that exists to cover it.
    void fetch_restored_profile() {
        client->core.fetch_user_profile([](bool) {
            // Nothing to do either way. Failure leaves the ordinary poll to find it, which is
            // where this started.
        });
    }

    /// Whether an account exists that was never confirmed.
    bool account_is_provisional() {
        return client->core.globals.have_account() &&
               client->core.globals.get_text(provisional_account_key).has_value();
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
        emit(ResponseFrame{Response{id, std::nullopt, std::nullopt, std::move(result)}});
    }

    void ok(double id) {
        respond(id, EmptyResult{});
    }

    void fail(
            double id, std::string_view message, std::optional<std::string> code = std::nullopt) {
        emit(ResponseFrame{Response{id, std::string{message}, std::move(code), std::nullopt}});
    }

    /// Wraps a handler so that the error leg is written once rather than at every call site.
    /// `result_function` hands the value and the failure as one object, and unwrapping it without
    /// checking is the one mistake this exists to prevent.
    template <typename F>
    auto on(double id, F&& f) {
        return [this, id, f = std::forward<F>(f)](auto&& result) {
            if (!result) {
                fail(id, result.error().message, std::string{result.error().code});
                return;
            }
            // Client::_dispatch_out only logs what escapes a handler, so an uncaught throw here
            // is a request that never gets a Response. setNickname on note to self is one.
            try {
                using R = std::decay_t<decltype(result)>;
                if constexpr (std::is_void_v<typename R::value_type>)
                    // Made dependent on R: the NDK's clang checks a non-dependent `f()` in the
                    // discarded branch as soon as `on` is instantiated, and every value handler fails.
                    dependent_on<R>(f)();
                else
                    f(*std::forward<decltype(result)>(result));
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
            AttachmentTransfer transfer, const client::AttachmentProgress& p) {
        transfer_progress(transfer, p.message_id, p.index, p.done, p.total, p.result);
    }

    void transfer_progress(
            AttachmentTransfer transfer,
            int64_t message_id,
            size_t index,
            int64_t done,
            int64_t total,
            const std::optional<Expected<void>>& result) {
        event(AttachmentProgressSessionEvent{
                transfer,
                static_cast<double>(message_id),
                static_cast<double>(index),
                static_cast<double>(done),
                static_cast<double>(total),
                // One report per transfer carries an outcome; the rest are still running.
                result ? std::optional{AttachmentOutcome{
                                 result->has_value(),
                                 result->has_value()
                                         ? std::nullopt
                                         : std::optional{std::string{result->error().code}}}}
                       : std::nullopt});
    }

    /// The upload handler for a message whose id is already known, as a retry's is. libsession
    /// reports one file's progress and then its outcome, all on Core's loop, so they can go to the
    /// stream as they come.
    client::Conversation::upload_progress report_upload(int64_t message_id) {
        return [this, message_id](
                       size_t index,
                       int64_t sent,
                       int64_t total,
                       std::optional<Expected<void>> result) {
            transfer_progress(AttachmentTransfer::upload, message_id, index, sent, total, result);
        };
    }

    /// The progress handler a command passes libsession, which reports to the stream rather than
    /// to the request: a transfer outlives the tap that started it, and the row that draws it may
    /// not have existed when it began.
    std::function<void(const client::AttachmentProgress&)> report(AttachmentTransfer transfer) {
        return [this, transfer](const client::AttachmentProgress& p) {
            attachment_progress(transfer, p);
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
        mark_provisional();
        client->core.globals.create_account(session::await);
        on_account();
        ok(id);
    }

    void handle(double id, const SetDisplayNameCommand& cmd) {
        client->set_display_name(cmd.name, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const RestoreAccountFromSeedCommand& cmd) {
        // A recovery password QR code carries 16 bytes: the lower half, the upper half zero.
        const auto length = cmd.hex_seed.size();
        if ((length != 32 && length != 64) || !oxenc::is_hex(cmd.hex_seed))
            throw std::invalid_argument{"hexSeed must be 16 or 32 bytes of hex"};
        auto raw = oxenc::from_hex(cmd.hex_seed);
        b32 seed{};
        std::memcpy(seed.data(), raw.data(), raw.size());
        mark_provisional();
        client->core.globals.restore_account(core::predefined_seed{std::span{seed}}, session::await);
        on_account();
        fetch_restored_profile();
        ok(id);
    }

    void handle(double id, const RestoreAccountFromWordsCommand& cmd) {
        const auto words = phrase_words(cmd.phrase);
        mark_provisional();
        client->core.globals.restore_account(
                cmd.language ? core::predefined_seed{words, *cmd.language}
                             : core::predefined_seed{words},
                session::await);
        on_account();
        fetch_restored_profile();
        ok(id);
    }

    void handle(double id, const CheckRecoveryPhraseCommand& cmd) {
        const auto words = phrase_words(cmd.phrase);
        // Built and thrown away. Deliberately the same constructor RestoreAccountFromWords uses
        // rather than a decode of its own: a phrase this accepts is then a phrase that restores,
        // and the word-count rule and the checksum cannot drift apart between the two answers.
        // Whatever it throws is carried back as the error, which is where libsession names the
        // unknown word.
        auto discarded = core::predefined_seed{
                words, cmd.language ? std::string_view{*cmd.language} : std::string_view{"English"}};
        static_cast<void>(discarded);
        ok(id);
    }

    /// Everything this client writes to disk, and what a discard does to each.
    ///
    /// **A table rather than a run of removals.** Something new the client starts writing is then
    /// a row with a decision in it, rather than a file that quietly outlives every discard
    /// because nobody thought to come back here. `keep` is the answer that needs a reason.
    std::vector<std::pair<std::filesystem::path, bool>> on_disk() const {
        auto wal = options.db_path;
        wal += "-wal";
        auto shm = options.db_path;
        shm += "-shm";
        return {
                {options.db_path, true},
                // The write-ahead log and its shared-memory index. A clean close checkpoints and
                // removes both, so ordinarily there is nothing here -- but a close is not
                // guaranteed to be clean, and a stale -wal beside a new database is a database
                // that will not open.
                {std::move(wal), true},
                {std::move(shm), true},
                // Encrypted under a key that lived in the database just deleted, so already
                // unreadable -- tidiness rather than safety, and skipping it would leave an
                // account's pictures on disk for ever.
                {options.cache_dir, true},
                // **Kept.** The public service-node list, no account data whatsoever, and what
                // makes the next attempt fast. A discard that cleaned everything beside the
                // database would throw away the one thing worth keeping.
                {netcache_path(options.db_path), false},
        };
    }

    /// Throws the account away and opens a new database in its place.
    ///
    /// Shared by the command and by the sweep at startup, which want exactly the same thing for
    /// different reasons: one because somebody went back, the other because nobody ever confirmed
    /// the account was wanted.
    void discard_account() {
        // Closed before anything is removed. Deleting a database out from under an open handle
        // leaves its pages alive until the last descriptor closes, which looks exactly like having
        // worked and is not.
        client.reset();

        std::error_code ec;
        for (const auto& [path, removed] : on_disk()) {
            if (!removed || path.empty())
                continue;
            // `remove_all` rather than `remove`: the same call takes a single file and a
            // directory, so a row does not have to say which it is.
            std::filesystem::remove_all(path, ec);
        }

        try {
            open_client();
        } catch (const std::exception& e) {
            open_failure = e.what();
            throw;
        }
        open_failure.clear();
        if (options.on_database_replaced)
            options.on_database_replaced();
    }

    void handle(double id, const DiscardAccountCommand&) {
        discard_account();
        ok(id);
    }

    void handle(double id, const KeepAccountCommand&) {
        // Erasing the marker is the whole of it: what it was protecting against is a start that
        // finds an account nobody confirmed.
        client->core.globals.erase(provisional_account_key);
        ok(id);
    }

    bool recovery_password_hidden() { return client->core.globals.seed_hidden(); }

    void handle(double id, const HideRecoveryPasswordCommand&) {
        client->core.globals.hide_seed();
        ok(id);
    }

    void handle(double id, const GetRecoveryPasswordHiddenCommand&) {
        respond(id, BoolResult{recovery_password_hidden()});
    }

    void handle(double id, const GetSeedMnemonicCommand& cmd) {
        if (recovery_password_hidden())
            return respond(id, SeedHiddenResult{});
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

    void handle(double id, const GetSeedHexCommand&) {
        if (recovery_password_hidden())
            return respond(id, SeedHiddenResult{});
        auto access = client->core.globals.account_seed();
        auto seed = access.seed();
        // The short form whenever it is the whole seed, as the 13 words are: it is what every
        // client's QR code holds, and what each one reads back.
        const bool short_form = std::all_of(
                seed.begin() + 16, seed.end(), [](std::byte b) { return b == std::byte{0}; });
        const auto end = short_form ? seed.begin() + 16 : seed.end();
        respond(id, HexResult{oxenc::to_hex(seed.begin(), end)});
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

    void handle(double id, const GetNetworkStatusCommand&) {
        std::lock_guard lock{network_status_lock};
        auto* net = client->core.network();
        respond(id,
                NetworkStatusResult{
                        net ? to_bridge(net->get_status()) : NetworkStatus::disconnected});
    }

    /// How many nodes are asked for, which is what decides whether the pool gets refreshed.
    ///
    /// `get_random_nodes` refreshes only when it cannot satisfy the count from unused nodes, so
    /// this is a floor on the pool rather than a number anybody consumes: the nodes themselves
    /// are dropped, and the cache they were fetched into is the whole product.
    static constexpr std::uint16_t WARM_NODE_COUNT = 12;

    void handle(double id, const WarmNetworkCacheCommand&) {
        // Nothing to gain once there is an account: the client's own network is attached, or is
        // about to be by `on_account`, and a second one refreshing the same cache is the cost this
        // avoids rather than the saving it makes.
        if (client->core.globals.have_account())
            return respond(id, BoolResult{false});

        // One at a time. Replacing a running one would block this thread on its loop, and the
        // second caller wants the cache warm rather than warmed twice.
        if (warm)
            return respond(id, BoolResult{false});

        auto planned = plan_network(options.network, options.db_path);
        if (!planned)
            return respond(id, BoolResult{false});

        warm = std::make_unique<session::network::Network>(
                session::network::config::Config{*planned});

        // Answered from the network's own loop, as every libsession callback here is. It does not
        // drop `warm`: that would join the loop it is running on. An empty list is how
        // `get_random_nodes` reports failure, so it is also the answer.
        warm->get_random_nodes(
                WARM_NODE_COUNT,
                [this, id](std::vector<session::network::service_node> nodes) {
                    respond(id, BoolResult{!nodes.empty()});
                });
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

    static client::MessageCursor cursor(const MessageCursor& from, std::string_view field) {
        return {from_epoch_ms(whole<int64_t>(from.timestamp, std::string{field} + ".timestamp")),
                whole<int64_t>(from.id, std::string{field} + ".id")};
    }

    void read_page(double id, const std::string& conversation_id, client::MessagePage page) {
        convo(conversation_id)
                .messages(std::move(page), on(id, [this, id](client::MessagePageResult page) {
                    std::vector<Message> out;
                    out.reserve(page.messages.size());
                    // libsession answers newest first, because that is the direction paging
                    // runs. The protocol is oldest first, because that is the direction a
                    // transcript is read, and reversing once here is cheaper than every caller
                    // remembering to.
                    for (auto& m : std::views::reverse(page.messages))
                        out.push_back(to_bridge(std::move(m)));
                    respond(id, MessagePageResult{std::move(out), page.has_newer, page.has_older});
                }));
    }

    void handle(double id, const GetMessagesCommand& cmd) {
        client::MessagePage page{
                .limit = whole<int>(cmd.limit, "getMessages.limit"),
                .include_deleted = cmd.include_deleted};
        if (cmd.before)
            page.before = cursor(*cmd.before, "getMessages.before");
        if (cmd.after)
            page.after = cursor(*cmd.after, "getMessages.after");
        if (!cmd.around) {
            read_page(id, cmd.conversation_id, std::move(page));
            return;
        }
        // Checked here because the cursor is only read a call later, and libsession's own refusal
        // of two positions would arrive after a lookup that was never wanted.
        if (cmd.before || cmd.after) {
            fail(id, "getMessages takes one of before, after and around");
            return;
        }
        const auto target = whole<int64_t>(*cmd.around, "getMessages.around");
        const auto conversation_id = cmd.conversation_id;
        client->message(
                target,
                on(id,
                   [this, id, target, conversation_id, page](
                           std::optional<client::Message> found) {
                       if (!found || found->conversation.to_string() != conversation_id) {
                           fail(id,
                                not_found("message", std::to_string(target)),
                                std::string{client::err::message_not_found});
                           return;
                       }
                       auto window = page;
                       window.around = found->cursor();
                       read_page(id, conversation_id, std::move(window));
                   }));
    }

    // Not const: the request is this call's to consume, so the body moves.
    void handle(double id, SendMessageCommand& cmd) {
        client::OutgoingMessage msg;
        msg.body = std::move(cmd.body);
        if (cmd.reply_to)
            msg.reply_to = whole<int64_t>(*cmd.reply_to, "sendMessage.replyTo");
        if (cmd.attachments) {
            msg.attachments.reserve(cmd.attachments->size());
            // Dimensions and ThumbHash are libsession's to read from the file, and `original_file`
            // is never set: nothing offers sending a picture as it is.
            for (auto& a : *cmd.attachments) {
                client::OutgoingAttachment out;
                out.path = utf8_path(a.path);
                out.content_type = std::move(a.content_type);
                out.filename = std::move(a.filename);
                out.take_file = a.take_file.value_or(false);
                msg.attachments.push_back(std::move(out));
            }
        }
        // A send that libsession refuses leaves its held reports unsent: with no id they name no
        // message, and the refusal is the request's answer.
        auto uploads = std::make_shared<HeldUploads>();
        convo(cmd.conversation_id)
                .send_message(
                        std::move(msg),
                        [this, uploads](
                                size_t index,
                                int64_t sent,
                                int64_t total,
                                std::optional<Expected<void>> result) {
                            if (!uploads->message_id) {
                                uploads->held.push_back({index, sent, total, std::move(result)});
                                return;
                            }
                            transfer_progress(
                                    AttachmentTransfer::upload,
                                    *uploads->message_id,
                                    index,
                                    sent,
                                    total,
                                    result);
                        },
                        on(id, [this, id, uploads](int64_t message_id) {
                            respond(id, MessageIdResult{static_cast<double>(message_id)});
                            uploads->message_id = message_id;
                            for (const auto& r : uploads->held)
                                transfer_progress(
                                        AttachmentTransfer::upload,
                                        message_id,
                                        r.index,
                                        r.sent,
                                        r.total,
                                        r.result);
                            uploads->held.clear();
                        }));
    }

    void handle(double id, AttachmentSendPlanCommand& cmd) {
        client->attachment_send_plan(
                utf8_path(cmd.path),
                std::move(cmd.content_type),
                on(id, [this, id](image::SendPlan plan) {
                    respond(id, SendPlanResult{to_bridge(plan)});
                }));
    }

    void handle(double id, const RetrySendCommand& cmd) {
        const int64_t message_id = whole<int64_t>(cmd.message_id, "retrySend.messageId");
        client->retry_send(
                message_id,
                report_upload(message_id),
                on(id, [this, id](bool started) { respond(id, BoolResult{started}); }));
    }

    void handle(double id, const SetGalleryCommand& cmd) {
        client->set_gallery(
                whole<int64_t>(cmd.message_id, "setGallery.messageId"),
                cmd.gallery,
                on(id, [this, id](bool done) { respond(id, BoolResult{done}); }));
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
        // The bytes are dropped: this is the call that *fills* the cache, and filling it is the
        // whole of what the command does. What reads the file is the media scheme.
        client->attachment_data(
                message_id,
                index,
                report(AttachmentTransfer::download),
                on(id, [this, id](std::vector<std::byte>) { ok(id); }));
    }

    void handle(double id, const ExportAttachmentCommand& cmd) {
        const int64_t message_id = whole<int64_t>(cmd.message_id, "exportAttachment.messageId");
        const auto index = whole<size_t>(cmd.index, "exportAttachment.index");
        client->save_attachment(
                message_id,
                index,
                utf8_path(cmd.destination),
                report(AttachmentTransfer::export_),
                on(id,
                   [this, id](std::filesystem::path saved_to) {
                       // Before the answer, which is what the app reveals the file on.
                       mark_downloaded(saved_to);
                       respond(id, PathResult{utf8_string(saved_to)});
                   }),
                cmd.notify_sender,
                cmd.replace);
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
        respond(id, PathResult{utf8_string(options.cache_dir)});
    }

    void handle(double id, const GetAttachmentUploadLimitCommand&) {
        client->attachment_upload_limit(on(id, [this, id](uint64_t bytes) {
            respond(id, ByteCountResult{static_cast<double>(bytes)});
        }));
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
        std::optional<int64_t> limit_bytes;
        if (cmd.limit_bytes) {
            limit_bytes = whole<int64_t>(*cmd.limit_bytes, "setAttachmentCacheLimit.limitBytes");
            // libsession would store it and evict until the cache fits, which is everything.
            if (*limit_bytes < 0)
                throw std::invalid_argument{
                        "setAttachmentCacheLimit.limitBytes must not be negative"};
        }
        client->set_attachment_cache_limit(limit_bytes, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const GetAttachmentCacheSizeCommand&) {
        client->attachment_cache_size(on(id, [this, id](int64_t bytes) {
            respond(id, ByteCountResult{static_cast<double>(bytes)});
        }));
    }

    void handle(double id, const GetThumbnailEdgeCommand&) {
        client->thumbnail_edge(on(id, [this, id](uint32_t edge) {
            respond(id, EdgeResult{static_cast<double>(edge)});
        }));
    }

    void handle(double id, const SetThumbnailEdgeCommand& cmd) {
        std::optional<uint32_t> edge_px;
        if (cmd.edge_px)
            edge_px = whole<uint32_t>(*cmd.edge_px, "setThumbnailEdge.edgePx");
        client->set_thumbnail_edge(edge_px, on(id, [this, id] { ok(id); }));
    }

    void handle(double id, const GetConfigSizesCommand&) {
        client->config_sizes(on(id, [this, id](std::unordered_map<std::string, int> measured) {
            std::vector<ConfigSize> sizes;
            sizes.reserve(measured.size());
            for (auto& [name, bytes] : measured)
                sizes.emplace_back(name, static_cast<double>(bytes));
            // By name, since the map has no order and an export should list them the same way
            // every time.
            std::ranges::sort(sizes, {}, &ConfigSize::name);
            respond(id, ConfigSizesResult{std::move(sizes)});
        }));
    }

    void handle(double id, const GetNetworkPathsCommand&) {
        std::vector<NetworkPath> paths;
        std::vector<CountryNodes> countries;
        if (auto* net = client->core.network()) {
            countries = nodes_by_country(*net);
            // On Core's loop, which is where the subscription moves it.
            auto [own, pubkey] = client->core.loop().call_get([&] {
                return std::pair{client->core.swarm_node(), client->core.globals.pubkey_x25519()};
            });
            // From the node cache once the swarm is known, so this answers a poll or two late
            // at most, and only the first time.
            net->get_swarm(pubkey, false, [cache = own_swarm](auto, auto swarm) {
                if (swarm.empty())
                    return;
                std::lock_guard l{cache->lock};
                cache->members.clear();
                for (const auto& node : swarm)
                    cache->members.push_back(node.remote_pubkey);
            });
            std::vector<::session::network::ed25519_pubkey> members;
            {
                std::lock_guard l{own_swarm->lock};
                members = own_swarm->members;
            }
            auto in_own_swarm = [&](const ::session::network::ed25519_pubkey& remote) {
                return (own && own->remote_pubkey == remote) ||
                       std::ranges::find(members, remote) != members.end();
            };
            for (auto& open : net->get_open_paths()) {
                std::vector<PathHop> hops;
                hops.reserve(open.path.hops.size());
                for (auto& hop : open.path.hops) {
                    auto country = ::session::ip_country::lookup(hop.ip);
                    hops.emplace_back(
                            hop.pubkey.hex(),
                            country ? std::optional<std::string>{*country} : std::nullopt);
                }
                // An onion-request path has no remote: it is named by the router instead.
                auto destination =
                        open.any_destination
                                ? (*open.any_destination == ::session::network::PathCategory::file
                                           ? PathDestination::any_file
                                           : PathDestination::any_node)
                        : open.remote_is_client      ? PathDestination::file_server
                        : in_own_swarm(open.remote) ? PathDestination::own_swarm
                                                    : PathDestination::storage_node;
                paths.emplace_back(
                        open.any_destination ? open.id : open.remote.hex(),
                        destination,
                        open.standby,
                        std::move(hops),
                        static_cast<double>(open.performance.latency.count()),
                        static_cast<double>(open.performance.jitter.count()) / 1000.0,
                        static_cast<double>(open.requests_sent),
                        static_cast<double>(open.proxied_requests_sent),
                        open.since_last_request
                                ? std::optional<double>{static_cast<double>(
                                          open.since_last_request->count())}
                                : std::nullopt,
                        static_cast<double>(open.performance.ping_responses));
            }
        }
        respond(id,
                NetworkPathsResult{NetworkPaths{
                        std::move(paths),
                        std::move(countries),
                        std::string{::session::ip_country::attribution()}}});
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
        auto* data = content.mutable_datamessage();
        data->set_body(cmd.body);
        if (cmd.reply_to) {
            auto* quote = data->mutable_quote();
            quote->set_author(cmd.reply_to->author);
            quote->set_msgtimestamp(static_cast<uint64_t>(
                    whole<int64_t>(cmd.reply_to->timestamp, "deliverTestMessage.replyTo.timestamp")));
        }
        if (cmd.attachments)
            for (const auto& a : *cmd.attachments) {
                auto* ptr = data->add_attachments();
                // Required by the schema, and read only by clients that predate `url`.
                ptr->set_id(0);
                ptr->set_contenttype(a.content_type);
                if (a.thumbhash)
                    ptr->set_thumbhash(a.thumbhash->data(), a.thumbhash->size());
                if (a.original_file.value_or(false))
                    ptr->set_flags(SessionProtos::AttachmentPointer::ORIGINAL_FILE);
            }
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

    // **A database that will not open leaves a bridge without a client, not no bridge.** Thrown
    // from here it took the bridge with it, so the app had nothing to ask and nothing to show: on
    // a phone the launch screen stayed up for good. Kept instead, every request is refused with
    // the reason -- which is what the startup-failure screen shows -- and a discard, which is how
    // somebody clears the device from that screen, opens a fresh database in its place.
    try {
        _impl->open_client();
    } catch (const std::exception& e) {
        _impl->client.reset();
        _impl->open_failure = e.what();
        return;
    }

    // **An account nobody confirmed does not survive a restart.** Between minting one and the end
    // of whatever was setting it up there is a window, and a crash in it leaves an identity behind
    // that was never finished with. Finding it here and throwing it away puts the application back
    // at its first screen rather than partway through a setup it has no memory of.
    //
    // For a restore that matters more than it sounds: such an account has the right identity and
    // no display name yet, so an application that carried on would be asking somebody to name an
    // account that already has a name on the network -- and taking the answer.
    if (_impl->account_is_provisional())
        _impl->discard_account();

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
    // Before the Impl, for the same reason as the logger: its callback holds `this` and answers on
    // the sink, and destroying a Network joins the loop that callback runs on -- so once this
    // returns, no warm answer can still be in flight.
    _impl->warm.reset();
    {
        std::lock_guard lock{_impl->network_status_lock};
        _impl->network_status_open = false;
    }
    _impl->client.reset();
    // Waits a bounded moment for a decode under way, so a stuck one cannot hold up a quit.
    _impl->staged->close();
    _impl.reset();
}

void ClientBridge::fetch_media(double message_id, double index, MediaHandler cb) {
    if (!_impl || !_impl->client) {
        cb(Media{"the bridge is closed", {}, {}});
        return;
    }

    // Both asked from here, on the caller's thread, and joined: a callback runs on Core's loop,
    // where `close()` can null `client` under it, so neither may reach back for the Client.
    struct Join {
        std::mutex lock;
        MediaHandler cb;
        int64_t id = 0;
        size_t at = 0;
        std::optional<session::Expected<std::optional<client::Message>>> message;
        std::optional<session::Expected<std::vector<std::byte>>> bytes;

        void settle() {
            auto& msg = *message;
            if (!msg)
                return cb(Media{std::string{msg.error().message}, {}, {}});
            if (!*msg || at >= (*msg)->attachments.size())
                return cb(Media{no_such_attachment(id, at), {}, {}});
            if (!*bytes && bytes->error().code == client::err::not_cached)
                return cb(Media{not_downloaded(id, at), {}, {}});
            if (!*bytes)
                return cb(Media{std::string{bytes->error().message}, {}, {}});
            // The sender's claim, and the only description there is. Whoever renders it is
            // handling bytes from a stranger either way.
            auto content_type =
                    (*msg)->attachments[at].content_type.value_or("application/octet-stream");
            cb(Media{std::nullopt, std::move(content_type), **std::move(bytes)});
        }
    };
    auto join = std::make_shared<Join>();
    join->cb = std::move(cb);

    try {
        join->id = whole<int64_t>(message_id, "media.messageId");
        join->at = whole<size_t>(index, "media.index");

        _impl->client->message(
                join->id, [join](session::Expected<std::optional<client::Message>> r) mutable {
                    std::lock_guard l{join->lock};
                    join->message.emplace(std::move(r));
                    if (join->bytes)
                        join->settle();
                });
        _impl->client->attachment_data_cached(
                join->id,
                join->at,
                [join](session::Expected<std::vector<std::byte>> r) mutable {
                    std::lock_guard l{join->lock};
                    join->bytes.emplace(std::move(r));
                    if (join->message)
                        join->settle();
                });
    } catch (const std::exception& e) {
        // Either call throwing means `bytes` is never set, so nothing else settles this.
        join->cb(Media{std::string{e.what()}, {}, {}});
    }
}

/// The long edge of a decoded placeholder.
///
/// A ThumbHash holds at most 7 cycles across the image, so decoding larger costs time without
/// carrying more detail; whatever draws it scales this up with a linear filter.
constexpr uint32_t thumbhash_long_edge = 32;

void ClientBridge::fetch_thumbhash(double message_id, double index, ThumbhashHandler cb) {
    if (!_impl || !_impl->client) {
        cb(Thumbhash{"the bridge is closed", 0, 0, {}});
        return;
    }

    try {
        const int64_t id = whole<int64_t>(message_id, "thumbhash.messageId");
        const auto at = whole<size_t>(index, "thumbhash.index");

        _impl->client->message(
                id,
                [id, at, cb = std::move(cb)](
                        session::Expected<std::optional<client::Message>> r) mutable {
                    if (!r) {
                        cb(Thumbhash{std::string{r.error().message}, 0, 0, {}});
                        return;
                    }
                    auto& msg = *r;
                    if (!msg || at >= msg->attachments.size()) {
                        cb(Thumbhash{no_such_attachment(id, at), 0, 0, {}});
                        return;
                    }

                    const auto& a = msg->attachments[at];
                    if (!thumbhash_decodable(a)) {
                        cb(Thumbhash{no_thumbhash(id, at), 0, 0, {}});
                        return;
                    }

                    // A hash carries no usable record of the source's shape, so the aspect ratio
                    // comes from the attachment's own metadata; without it, square is the only
                    // honest guess.
                    uint32_t w = thumbhash_long_edge, h = thumbhash_long_edge;
                    if (a.width && a.height) {
                        if (*a.width >= *a.height)
                            h = std::max(1u, thumbhash_long_edge * *a.height / *a.width);
                        else
                            w = std::max(1u, thumbhash_long_edge * *a.width / *a.height);
                    }

                    auto img = image::thumbhash::decode(*a.thumbhash, w, h);
                    cb(Thumbhash{
                            std::nullopt,
                            static_cast<double>(img.width),
                            static_cast<double>(img.height),
                            std::move(img.rgba)});
                });
    } catch (const std::exception& e) {
        cb(Thumbhash{std::string{e.what()}, 0, 0, {}});
    }
}

void ClientBridge::fetch_thumbnail(double message_id, double index, MediaHandler cb) {
    if (!_impl || !_impl->client) {
        cb(Media{"the bridge is closed", {}, {}});
        return;
    }

    try {
        const int64_t id = whole<int64_t>(message_id, "thumbnail.messageId");
        const auto at = whole<size_t>(index, "thumbnail.index");

        _impl->client->attachment_thumbnail(
                id,
                at,
                [id, at, cb = std::move(cb)](session::Expected<std::vector<std::byte>> r) mutable {
                    if (r) {
                        cb(Media{std::nullopt, "image/jpeg", *std::move(r)});
                        return;
                    }
                    // The sentences the fake says too, so a refusal reads the same on both.
                    const auto code = r.error().code;
                    if (code == client::err::no_thumbnail)
                        cb(Media{no_thumbnail(id, at), {}, {}});
                    else if (
                            code == client::err::message_not_found ||
                            code == client::err::attachment_not_found)
                        cb(Media{no_such_attachment(id, at), {}, {}});
                    else
                        cb(Media{std::string{r.error().message}, {}, {}});
                });
    } catch (const std::exception& e) {
        cb(Media{std::string{e.what()}, {}, {}});
    }
}

void ClientBridge::fetch_rendition(double message_id, double index, MediaHandler cb) {
    if (!_impl || !_impl->client) {
        cb(Media{"the bridge is closed", {}, {}});
        return;
    }

    try {
        const int64_t id = whole<int64_t>(message_id, "rendition.messageId");
        const auto at = whole<size_t>(index, "rendition.index");

        _impl->client->attachment_rendition(
                id,
                at,
                [id, at, cb = std::move(cb)](session::Expected<std::vector<std::byte>> r) mutable {
                    if (r) {
                        auto type = rendition_content_type(*r);
                        if (!type)
                            cb(Media{"the rendition is not a JPEG or WebP", {}, {}});
                        else
                            cb(Media{std::nullopt, *std::move(type), *std::move(r)});
                        return;
                    }
                    const auto code = r.error().code;
                    if (code == client::err::no_rendition)
                        cb(Media{no_rendition(id, at), {}, {}});
                    else if (
                            code == client::err::message_not_found ||
                            code == client::err::attachment_not_found)
                        cb(Media{no_such_attachment(id, at), {}, {}});
                    else
                        cb(Media{std::string{r.error().message}, {}, {}});
                });
    } catch (const std::exception& e) {
        cb(Media{std::string{e.what()}, {}, {}});
    }
}

std::function<void()> ClientBridge::fetch_staged_thumbnail(std::string path, MediaHandler cb) {
    if (!_impl || !_impl->client) {
        cb(Media{"the bridge is closed", {}, {}});
        return [] {};
    }
    if (!is_staged_path(path)) {
        cb(Media{"not an absolute path", {}, {}});
        return [] {};
    }

    // The edge arrives on Core's loop, so a cancel can come before the request it withdraws.
    Deferred deferred;

    // The edge libsession will make this file's thumbnail at once it is sent, so the tile and the
    // message it becomes draw the same picture.
    _impl->client->thumbnail_edge([staged = _impl->staged,
                                   deferred,
                                   path = std::move(path),
                                   cb = std::move(cb)](session::Expected<uint32_t> edge) mutable {
        if (!edge) {
            cb(Media{std::string{edge.error().message}, {}, {}});
            return;
        }
        deferred.make(
                [&] { return staged->request(std::move(path), *edge, std::move(cb)); },
                [&] { cb(Media{"cancelled", {}, {}}); });
    });

    return deferred.canceller();
}

void ClientBridge::call(Request request) {
    // Nothing can be answered once the Impl is gone: there is no sink left to answer on. The
    // caller's pending requests were rejected by `close` before it got here.
    if (!_impl)
        return;

    // **Refused, not dropped.** A discard that could not reopen the database leaves the Impl with
    // no client, and every request after it used to return from here without a response at all.
    // Nothing above has a timeout, so the promise each was made for never settled and the app
    // simply stopped, with nothing said anywhere.
    //
    // A discard is the exception: it is what replaces a database that would not open.
    if (!_impl->client && !std::holds_alternative<DiscardAccountCommand>(request.command)) {
        _impl->fail(
                request.id,
                _impl->open_failure.empty()
                        ? std::string{"the bridge has no database open"}
                        : "the bridge has no database open: " + _impl->open_failure);
        return;
    }

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
