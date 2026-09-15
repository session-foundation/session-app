#pragma once

#include <array>
#include <cstddef>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "session_bridge/gen/types.hpp"

namespace session_bridge {

/// One log category turned up or down.
///
/// Declared here rather than generated: `SessionBridgeOptions` is read by each adapter directly
/// rather than crossing as a protocol frame, so the generator never sees this type. It mirrors
/// `@session/bridge-types`' `LogCategoryLevel`, and the level is a plain string for the same
/// reason `log_level` is - libsession takes the name, not an enum this side.
struct LogCategoryLevel {
    std::string category;
    std::string level;
};

/// Which network to reach and how to find it.
///
/// Also what `attachNetwork` carries, so the two ways in cannot describe a network differently.
struct NetworkOptions {
    /// "mainnet", "testnet", "devnet", or empty to never reach one.
    ///
    /// Empty is the whole of the offline guarantee: attaching is the only thing that gives Core a
    /// way off the machine, so declining to do it is more dependable than a flag each send has to
    /// remember to consult. The contract suite runs this way, and so does anything that must not
    /// touch a real swarm.
    ///
    /// Attached at construction when an account already exists, and again after `createAccount`
    /// or `restoreAccount`, because attaching to an identity-less Core throws and there would be
    /// nothing to poll for anyway.
    std::string netid;

    /// Where a devnet starts, and the one thing it has no default for: libsession ships mainnet's
    /// and testnet's seed lists behind a private constructor and lets neither be replaced, so a
    /// devnet that names none has nowhere to begin. Ignored on the other two.
    std::vector<SeedNode> seed_nodes;

    /// Empty leaves the built-in file server for the netid, which for devnet is **mainnet's**.
    std::optional<FileServerConfig> file_server;

    /// Unset takes the netid's default: Session Router on mainnet and testnet, onion requests on
    /// devnet, which is the only thing a devnet can use.
    std::optional<RouterKind> router;
};

/// Everything the bridge needs to open a Client, and nothing it can work out for itself.
///
/// The database key is the application's to custody: libsession accepts one but neither derives
/// nor stores it, which is the entire reason the apps have a secure-storage port. Supply exactly
/// one of `raw_key` (what a new install generates and keeps in the OS keyring) or `password`
/// (the fallback where there is no keyring to keep it in); with neither, the database is opened
/// unencrypted, which is for tests.
struct InitOptions {
    std::filesystem::path db_path;

    /// Where attachment bytes are cached. Must be writable and is the application's to clear.
    std::filesystem::path cache_dir;

    std::optional<std::array<std::byte, 32>> raw_key;
    std::optional<std::string> password;

    /// Passes libsession's `session::core::defer_account` to the Client constructor; the bridge
    /// adds nothing of its own here.
    ///
    /// Opens the database without creating an account, so that `getAccountInfo` can answer "no"
    /// and the app can show onboarding. **Without this a Client creates one on first open**, and
    /// an app that meant to ask the user has already decided for them. Between construction and
    /// `createAccount` or `restoreAccount` there is no identity, so anything needing one - the
    /// session id, sending, attaching a network - fails until that call.
    bool defer_account = false;

    /// Which network to reach and how to find it, or nothing to never reach one.
    ///
    /// One struct because `attachNetwork` replaces the whole of it in a single call, and the
    /// parts only make sense together: a netid without the seed nodes it needs reaches nothing.
    NetworkOptions network;

    /// What this client tells the account's other devices it is: "ios", "android" or "desktop".
    ///
    /// libsession establishes the device group with these fields blank and says outright that
    /// filling them in is the application's job; until it happens, every other device lists this
    /// one as an unrecognised device with no version. There is no device type for this client
    /// yet - see docs/STATUS.md - so it reports the platform it is running on, which is true.
    std::string device_type;

    /// How much of libsession's own logging to forward, as `log` events.
    ///
    /// "trace", "debug", "info", "warn", "error", "critical", or empty for none. Worth having
    /// because the state machine reports *what* happened and not *why*: a send that ends in
    /// `failed` carries no reason, and the reason is in these lines.
    ///
    /// Registered process-wide, so a second bridge in one process would double them up. There is
    /// one, and `close()` takes its logger back off again.
    std::string log_level;

    /// Per-category overrides, applied after `log_level` has been given to every category.
    ///
    /// A single level is unusable: `quic` and `session-router` produce thousands of lines a second
    /// at debug and bury whatever was being looked for. A category no dependency declares is
    /// created rather than refused - libsession's `Cat()` makes one on demand - so it matches
    /// nothing and costs nothing, which is why the names are checked before they get here.
    std::vector<LogCategoryLevel> log_categories;
};

/// Receives one `Frame` per call, in the order libsession produced them.
///
/// **Called on Core's event loop, and must only enqueue.** Moving the frame into a queue is the
/// whole of what belongs here; the hop to the JavaScript thread and turning the struct into a
/// JavaScript object belong to the platform adapter. A sink that blocks stalls polling, message
/// receipt and every other call in flight; a sink that throws loses the frame.
using Sink = std::function<void(Frame)>;

/// The answer to one media request: the bytes, or why there are none.
///
/// `error` and `bytes` are exclusive - a failure carries no content type either, since what the
/// sender claimed describes a file that never arrived.
struct Media {
    std::optional<std::string> error;
    std::string content_type;
    std::vector<std::byte> bytes;
};

using MediaHandler = std::function<void(Media)>;

/// One libsession Client behind one ordered frame stream.
///
/// Deliberately sets **no libsession dispatcher**. `callbacks.hpp` prescribes handlers that move
/// their argument into the application's own queue and return, which is exactly what filling a
/// frame and enqueueing it is - so the handlers run inline on Core's loop and the platform
/// adapter owns the hop onto the JavaScript thread. Installing a dispatcher as well would add a
/// second queue in front of ours, buying nothing and costing the ordering guarantee that having
/// one queue is what provides.
///
/// Command responses go to the same sink as events, correlated by request id, because their
/// relative order is load-bearing: see `Frame` in @session/bridge-types.
class ClientBridge {
  public:
    /// Opens the database and publishes the initial state. Throws if the database cannot be
    /// opened - a wrong key, a directory that is not writable - since there is no bridge to
    /// report that failure over yet.
    ClientBridge(InitOptions options, Sink sink);
    ~ClientBridge();

    ClientBridge(const ClientBridge&) = delete;
    ClientBridge& operator=(const ClientBridge&) = delete;

    /// Dispatches one request. Returns as soon as the work is handed to Core; the answer arrives
    /// on the sink as a `Response` carrying the same id.
    ///
    /// Never throws: a request that names something that does not exist or fails validation
    /// comes back as a Response with `error` set. Throwing here would surface on whichever thread
    /// the adapter happens to call from, where nothing knows which request it belonged to.
    void call(Request request);

    /// An attachment's bytes, decrypted, for something that draws them.
    ///
    /// **Deliberately not a command.** The frame stream carries state, and its ordering is what
    /// makes a display bindable - putting a file on it would stall every state frame behind a
    /// payload that no event can contradict anyway. So this answers its own caller, and what
    /// reaches a renderer is a URL its platform resolves natively rather than a frame.
    ///
    /// Progress still goes to the sink, as `attachment-progress` with `transfer: "download"`, so
    /// a picture loading draws the same bar as a tap does and a row that mounts halfway through
    /// reads the same state. A file already cached reports nothing and answers at once.
    ///
    /// `cb` runs on whichever thread libsession finished on, which is Core's loop. It must only
    /// hand the bytes on, for the same reason `Sink` must only enqueue.
    void fetch_media(double message_id, double index, MediaHandler cb);

    /// The bridge this process opened, or nullptr before one exists.
    ///
    /// A platform's image loader is reached by the operating system rather than by us - an
    /// `RCTImageURLLoader`, a Fresco fetcher, a registered scheme - so it has no way to be handed
    /// anything. One client per process is already true; this is what lets that be relied on.
    static ClientBridge* current();

    /// Stops delivering frames and destroys the Client, which joins Core's loop. Idempotent, and
    /// implied by the destructor. Handlers for calls still in flight are dropped rather than
    /// completed - the facade rejects their promises, which is where "exactly once" is restored.
    void close();

  private:
    struct Impl;
    std::unique_ptr<Impl> _impl;
};

}  // namespace session_bridge
