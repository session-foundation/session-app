# session-app

One shared UI across an Expo app (Android and iOS, phone and tablet) and an Electron app
(Linux, macOS, Windows). libsession-util's `client` branch is the backbone: it owns the
database, polling, sending, receiving, attachments and retries. The apps render what it says
the state is and forward actions to it.

There is no web app. Desktop means Electron.

## The shape of it

```
libsession-util (C++, submodule)
        │  frames: commands in, responses and events out - one ordered stream
        ▼
@session/client ── the SessionClient interface, one facade, three implementations
        │        Nitro module (mobile) · addon behind preload (desktop) · the fake
        ▼
@session/state ── a projection of libsession's events. No optimistic writes.
        │
        ▼
@session/screens ── the screens, and AdaptiveShell which decides how many panes fit
        │            drawn with @session/ui (tamagui) · addressed by @session/test-ids
        ▼
apps/mobile · apps/desktop ── route files, OS ports, boot order. Adapters, nothing more.
```

Who may import whom is in `tooling/depcruise-config/root.cjs` and enforced by
`pnpm boundaries`. The short version: `ui` imports no sibling but tokens and ids; `screens`
imports ui, state, app, client and localization; nothing imports an app.

## The bridge

`packages/bridge-types` is the protocol: TypeScript types, and nothing else. `Frame` is what the
shim emits (a `Response` or a `SessionEvent`), `Request` is what it accepts, and every value that
crosses is a plain object of exactly the type a screen renders - the C++ builds it, no codec in
between. Two decisions are worth knowing before changing anything:

**Responses ride the same stream as events.** libsession's contract is that a display can be
built by asking once and then applying events. That only holds if a `conversation-list-replaced`
produced _before_ the answer to `getConversations` is also applied before it. A promise
resolving on one channel while events arrive on another gives no such guarantee across IPC or
JSI, and the failure would be a stale row appearing on a race nobody can reproduce. One FIFO
stream carries libsession's own ordering through to TypeScript; the facade still hands callers
promises, resolved from `Response` frames. A per-method promise API on Nitro was considered and
is unsafe: an already-resolved C++ promise settles as a microtask ahead of events already queued
on the CallInvoker, and half of the shim's commands answer synchronously.

**Every event carries whole state.** Never an id to go and fetch. That is what makes a display
bindable, applying the same event twice harmless, and startup race-free.

Numbers are `number` on both sides: every 64-bit value is a unix-millisecond timestamp, a sqlite
rowid or a byte count, all far inside 2^53, and the C++ carries them as doubles.

### The generated C++

`tooling/bridge-codegen` reads `packages/bridge-types` and writes three committed headers under
`packages/bridge-core/include/session_bridge/gen`: `types.hpp` (plain structs, an `enum class`
per string union, a `std::variant` per tagged union), `jsi.hpp` (Nitro `JSIConverter`
specialisations, mobile only) and `napi.hpp` (node-addon-api conversions, desktop only). The
generator accepts a deliberate subset of TypeScript - string, number, boolean, string-union
aliases, interfaces, arrays of those, and unions of object literals tagged by a literal `type` -
and refuses anything else with the offending declaration named. `codegen:check` fails on drift.

A struct with fields has one constructor taking all of them and no default constructor, so a
field added in TypeScript is a build failure in the shim until it is filled. An unset optional is
left off the object rather than written as `undefined`, which is what exactOptionalPropertyTypes
means on the other side.

The whole bridge is one flat `session_bridge` namespace. `session::bridge` would declare a
top-level `session`, and Apple's `<sys/sysctl.h>` already declares `struct session` there - which
these headers meet, because the Nitro spec pulls them into the pod's module umbrella. The
collision is a module that cannot be built rather than a line that can be fixed locally, so the
two shim translation units that used to reach libsession's names by enclosing-scope lookup say
`using namespace ::session` instead.

### The shim

`packages/bridge-core` is one C++ `ClientBridge` compiled against the client-branch headers, with
a Nitro module in front of it on mobile and an N-API addon in the Electron main process. It
registers every libsession callback at construction, fills a `Frame` struct from each, and hands
it to a sink that only enqueues. It sets **no libsession dispatcher**: handlers run inline on
Core's loop doing nothing but fill-and-enqueue, and the platform adapter owns the hop onto the
JS thread, where the struct becomes a JavaScript object. Commands arrive as a `Request` struct and
are dispatched by `std::visit`, so a command added to the protocol without a handler does not
compile. `packages/client/src/fake/fakeBridge.ts` is the same dispatch written in TypeScript and
is the reference to match; its handler table is keyed by command tag for the same reason.

Conversation-scoped commands build a `Conversation` on the stack per call. That is safe because the
handler form copies the client pointer and the id into its lambda - the `wait` form captures
`this`, which is one more reason the shim never uses it.

`packages/bridge-node` is the addon in front of it. It owns exactly one thing: the hop from
Core's loop onto the JavaScript thread, through a thread-safe function with an unbounded queue, so
that a frame produced on the loop is never dropped and producing one never blocks. N-API rather
than NAN, so one build loads in both Node and Electron - which is what lets the addon be tested
under vitest without an Electron process at all. On desktop the frame then crosses to the renderer
by structured clone over one MessagePort, which the preload hands into the page's main world and
never touches again; the preload needs nothing from Node and the renderer runs sandboxed.

`packages/bridge-rn` is the Nitro module. Its spec names the protocol types through nitrogen's
`CustomType` as opaque brands pointing at `jsi.hpp`, because nitrogen cannot generate a struct
for a TypeScript union; the one adapter that touches the spec casts the brand to the real type.
`setSink` is not in the spec: the C++ registers it as a raw JSI method and dispatches the frame
to the JS thread itself, because Nitro's typed callback wrapper copies its arguments once on the
way there, and the frame is the one thing this module exists not to copy.

Two commands in the protocol have no libsession counterpart and answer with an error rather than
something that half works. `approveConversation`: approval is not a flag anyone sets, it is
recorded by messages flowing, so writing to someone is what approves them. `pollOnce`: Core owns
its poll ticker and exposes no one-shot entry point. Both are open questions in `STATUS.md`.
Attachment metadata, transfer progress and the per-conversation auto-download setting cross;
bytes do not. A cache file libsession wrote is encrypted, so reaching one means a decrypting path
per platform rather than a payload on this stream - see `STATUS.md`. `downloadAttachment` is also
how a caller asks whether the bytes are here: libsession records nothing about a transfer, so the
one call reads the cache, joins a fetch already running, or starts one.

## The fake, and why it is not a stub

`@session/client/fake` is a working libsession: it delivers between accounts on a manual clock,
routes a first message into the request list, moves a row between lists on approval, and marks
anything in flight `interrupted` across a restart. Both apps run on it today.

`@session/client-contract` is the behavioural suite both implementations must satisfy. It runs
against the fake on every push and will run against the addon offline, feeding messages through
libsession's own test path rather than a network. It has already earned its keep: it caught the
fake calling a `pending` send uninterrupted after a restart.

**Any change to the bridge updates the fake and the contract in the same pull request.** A fake
nobody checks is a fake that quietly stops predicting anything.

## State

`applyEvent` is a pure function from `(state, event)` to state, tested by replaying event logs.
Two rules in it are invisible until they are not:

- An approved conversation must leave the list it came from. Approval arrives as an _update_,
  not a removal and an addition, so a projection that only inserts shows the row twice.
- A message event for a conversation whose history was never loaded is dropped. A window built
  from one event looks complete and is not.

Sending adds no optimistic row. libsession stores the message before the call resolves and
announces it, so there is nothing to reconcile and nothing to put back on failure.

## Screens, and how one UI fits three shapes

`AdaptiveShell` is the only place that decides how many panes are on screen: one below 700px,
list and detail above it, a wider list above 1100. The routes are identical either way, so a
link, a notification tap and the back button behave the same on every device.

Route params are extracted at the route file and passed as props. A screen never reads a
router - that would be the one import that pins it to a platform again. `routes.ts` builds
every path, and `routes.contract.test.ts` holds the three declarations of each route together:
the builder, the desktop table it scrapes as text, and the expo-router file it looks for on
disk.

## Ports

libsession hides the data, so the ports are only about the operating system: secure storage for
the database key (libsession takes a key but neither derives nor stores one), file pickers that
return real paths, image dimensions, notifications, clipboard, links, window focus.

They are installed once at boot by a side-effecting import, before anything renders, because
the store and the boot sequence both read them from outside React. `requirePorts()` throws
rather than returning null: a missing port is a mistake in the app's entry file, and failing
there names it.

## Testing

| tier     | what                                                  | when                         |
| -------- | ----------------------------------------------------- | ---------------------------- |
| unit     | projections, route contracts, the generator, the fake | every push                   |
| fast e2e | the Electron app on the fake, no network              | `e2e-fast` workflow, by hand |
| full e2e | real bindings, devnet, device pool                    | `e2e-full` workflow, by hand |

`tests/e2e/harness/ISessionApp.ts` is the platform-neutral driver interface. Its rule: every
member takes and returns primitives, enums or plain data - no Playwright `Locator`, no Appium
element. Anything one platform cannot do belongs somewhere narrower until every platform can.

`sessionTest` is the only way to declare a test and the only thing that opens or closes a
client. Its `clients` descriptor decides the platforms _and_ the tags, so a spec asking for two
clients is tagged `@2-devices` without anyone writing it down.

**One id per element**, in `@session/test-ids`, used as the component's `testID` and as the test's
selector. Verified: `testID` reaches the DOM as `data-testid` untouched through
react-native-web, so the per-platform locator table the appium suite needs does not exist here.
Release builds strip the attribute; QA builds keep it. An element a test cannot address is a
missing entry in the registry plus a missing `testID` on the component - never a reason to
reach for an xpath.

### The token trap, and what guards it

A tamagui token that does not exist resolves to **0, in silence**. `padding="$1.5"` on a scale
without a 1.5 loses the padding; `color="$textPrimry"` paints nothing. TypeScript does not help -
every one of those props is typed as a plain string, so a typo compiles.

`packages/ui/tests/tokens.contract.test.ts` guards both halves: every `$name` written in `ui`,
`screens` or either app names something that exists, and every theme defines the whole of
tamagui's own vocabulary - a built-in asks for `$backgroundFocus` and renders invisibly if
nothing answers.

A test rather than a lint rule because the valid list is computed rather than written down: it
comes from the scales and from whatever `@session/theme-tokens` publishes, and a rule would need
that duplicated to read it. The cost is that it fails on push rather than while typing.

## Things that only running the app finds

- **react-native's layout wants every ancestor to be a flex container.** A browser's root is
  not, so the app rendered a perfectly correct DOM at zero pixels tall. `#root { display: flex }`
  in the host page is the whole fix.
- **`ELECTRON_RUN_AS_NODE=1` is set by many terminals**, and Electron then refuses Chromium's
  flags and runs your main file under plain Node. The harness clears it.
- **The renderer asks for the account before the MessagePort arrives.** Both directions are
  buffered in the renderer's port transport; dropping that first request strands the app on its
  loading screen with nothing in the logs.
- **`@tamagui/vite-plugin` peers on vite 8 and electron-vite is on vite 7.** It is an
  optimising compiler, not a requirement. Add it when electron-vite catches up.
- **TypeScript is held at 5.x** because typescript-eslint declares `<6.1.0`, and the typed
  rules are the most valuable ones in a repo whose bridge is entirely async.

## Building the native side

Two things cost real time on a first clone, and neither is discoverable from a failure message:

- **libsession-util's submodule tree is 37 deep.** `--reference
~/pro/contribs/libsession-util/.git/modules/<path>` per submodule borrows the objects already on
  disk; a plain recursive init downloads about a gigabyte.
- **gmplib.org drops connections often enough to matter**, and it is where gmp comes from.
  `-DLOCAL_MIRROR=https://oxen.rocks/deps` is tried ahead of every dependency's own mirror, so one
  flag takes the whole static build off the upstream hosts rather than just gmp. The hashes are
  checked either way.

Which compiler, and why, is in the decision log. How to build and run each client is the `run`
skill's.

## Environment split

Each shared package typechecks with `types: []` and no DOM, so a stray `window` is an error.
The two apps then re-check the same sources: the desktop renderer under a browser lib, the
mobile app under react-native's types with `moduleSuffixes` resolving the `.native` variants.
Every shared file is checked two or three ways per run, with no synthetic profiles to maintain.

## Decision log

Append one paragraph per decision. Undocumented decisions are what rot.

- **2026-09-04 - Responses share the event stream.** Ordering across the boundary is what
  makes hydration race-free; two channels cannot promise it.
- **2026-09-04 - `@session/localization` is consumed as built output.** It wraps a vendored
  submodule whose generated files do not satisfy our strict flags and are not ours to change.
  Building it means consumers read declarations, which `skipLibCheck` covers. It is the only
  package resolved to `dist` rather than `src`.
- **2026-09-04 - dependency-cruiser is the sole boundary authority.** `turbo boundaries` was
  considered and dropped: a second mechanism with its own model, for rules dep-cruiser already
  expresses.
- **2026-09-04 - libsession is cross-compiled separately for Android, not built in place.**
  session-deps hands its CMake-based dependencies the NDK compiler without the NDK target, so a
  build inside the Gradle CMake project produces a simdutf for the host and the link fails on
  libstdc++ symbols Android does not have. `utils/static-bundle.sh` per ABI is the supported path
  and `bridge-core` takes a prebuilt archive when given one. The same reasoning will apply to iOS,
  whose artifact is an xcframework from `utils/ios.sh`.

- **2026-09-04 - Fixes for the submodule lived in `patches/` until they landed upstream.** Three
  in the end, all wanted in the repository that owned them rather than here: libevent built
  without `-fPIC`, session-deps not forwarding the cross toolchain to its CMake dependencies, and
  session-router refusing `arm64` on macOS. A submodule two levels down cannot be committed from
  this repository and a build cannot wait for a release, so the build applied them and a script
  made that idempotent and visible.

  All three are upstream as of session-deps `30b20092` and session-router `054d3b9f`, so the
  directory, the script and the build step that ran it are gone. Kept as an entry because the
  arrangement is worth reaching for again: a patch that is a diff to send, applied by the build
  and deleted on merge, rather than a fork to maintain.

- **2026-09-04 - History crosses the bridge oldest first.** libsession answers newest first,
  because that is the direction paging runs; a transcript is read the other way. The shim reverses
  once rather than leaving every caller to remember, and the order is written into `frames.proto`
  rather than left for each implementation to decide - which is how the fake and the real thing
  came to disagree about it in the first place. Getting this wrong shows up as a conversation that
  reads bottom to top.

- **2026-09-04 - A terminal send state, not a particular one.** The contract asserted that a send
  ends up `sent`, which is true only where there is a swarm to reach. Offline it ends up `failed`,
  and that is the same contract: what the scenario is about is that the state arrived as an update
  rather than a second message. An assertion that only the fake could satisfy was an assertion
  about the fake.

- **2026-09-04 - A Client creates an account unless told not to.** Opening a database is enough
  to mint an identity, so an app that means to offer "create or restore" has already chosen for
  the user by the time it draws anything. `defer_account` is what holds that open, and it is not
  a detail of onboarding: it is a constructor argument, decided before the first frame. The
  desktop app passes it, and `getAccountInfo` answers without an account rather than asking for a
  display name that would throw.

- **2026-09-04 - Nothing linked into the addon may hold absolute relocations.** Obvious in
  hindsight, and it cost a build: libsession's own targets are position-independent, its autotools
  dependencies get there through `--with-pic`, and libevent is the one exception, because its dep
  script overrides the shared configure command and does not carry the flag over. There is no hook
  to add one and session-deps is two submodules down, so the flag goes on the compiler instead -
  `packages/bridge-node/cmake/cc-pic.sh`, to be deleted when upstream closes the gap. The Nitro
  module will want the same thing, which is why our own proto target sets POSITION_INDEPENDENT_CODE
  rather than the addon reaching in to say so.

- **2026-09-04 - The shim's protobuf C++ is generated at build time, not committed.** The
  TypeScript codecs are committed because everything that consumes them is a TypeScript build with
  no toolchain of its own. The C++ classes are the opposite case: the only thing that needs them
  already has CMake and a compiler. Committing them would put a pinned `protoc` on the per-PR job,
  which compiles no C++ at all, and a version drift there would fail `codegen:check` in a job with
  no way to be right.

- **2026-09-04 - The native build uses gcc on Linux, not clang.** libsession's static dependencies
  include libtasn1, whose gnulib vendoring skips its own `bool` shim only when the compiler is in
  C23 mode. gcc 15 defaults to C23; clang 21 still defaults to C17, engages the shim, and cannot
  compile it, because the `HAVE_STDBOOL_H` the shim needs is never defined. Nothing about our own
  code prefers either compiler, and the plan's clang+lld preference predates meeting this.

- **2026-09-04 - Three wire fields were wrong, and the shim is what found them.** `Attachment` had
  `downloaded`, which libsession does not report: what it has is `uploaded` - on the file server -
  and it deliberately records no local path, because the application chose it and a stored copy
  would go stale the moment the file moved. `Attachment.size` is optional upstream, unset until an
  outgoing attachment has uploaded. `Message.unread` had no source at all: unread is a count on the
  conversation, and the field existed only because the fake had found it convenient. A fake with
  nothing to check it against had encoded all three as facts.

- **2026-09-04 - Both e2e workflows are manual.** They need a device pool or a devnet, and a
  pull request should not wait on either.

- **2026-09-07 - Protobuf is gone from the bridge; the TypeScript types are the protocol.** The
  wire format cost an encode, a serialise, a decode and a convert on every frame, and on desktop
  three byte copies besides, for a boundary whose two sides always ship together. Now the shim
  fills a struct generated from `@session/bridge-types`, Nitro builds the JavaScript object from
  it on the JS thread, and the addon builds it in the main process and structured-clones it to the
  renderer. What was kept on purpose: the single ordered stream, the fake behind the same
  transport interface, the contract suite unchanged. What replaced the codec round-trip test is
  `echoTestFrame`, a test-only command that pushes a frame through both converter directions and
  is asserted exactly, absent optionals included. This supersedes the 2026-09-04 entry on not
  committing generated C++: that argument was a pinned `protoc` on a job with no compiler, and the
  generator is Node, which every job has. Attachment bytes were deliberately left out of the
  protocol until attachments are designed; the cache files are encrypted.

- **2026-09-08 - One materialisation per frame on mobile; desktop keeps two.** An audit of every
  copy between libsession and a screen. Fixed here: Nitro's `AsyncJSCallback::operator()` passes
  its arguments on as lvalues and so deep-copied every frame before the hop, which is why
  `setSink` is now a raw JSI method; the shim moves out of everything libsession hands over by
  value; the facade passes events through by reference; the store rebuilds only the containers on
  the path to a change. Left as is, deliberately: the desktop hop, where the addon builds V8
  objects in the main process and structured clone builds them again in the renderer. JSON text
  parsed in the renderer would have made it one materialisation plus a string memcpy, at the price
  of a third codegen emitter; the addon in the renderer would have made it one, at the price of
  nodeIntegration in a window that renders untrusted messages. Neither is worth it for a frame
  stream this size. The libsession half - four `const&` change callbacks handing over a temporary
  the caller destroys next, and `_emit_lists_replaced` copying both lists into by-value
  parameters - is fixed on the `client` branch.

- **2026-09-08 - Attachments left the protocol until there is a design for them.** The types, the
  two progress events, the `autoDownload` setting and the facade's progress-callback routing are
  all gone. The bytes were never going to cross (see the entry above), and what was left described
  a feature nothing renders: a `Message.attachments` every screen ignored, a progress stream
  nothing subscribed to, and routing whose only user was a retry nobody could observe. Two things
  fell out of it. `BridgeEvent` and `SessionEvent` differed in exactly one arm - the request id on
  a transfer report - so there is now one union, `SessionEvent`, and the facade hands the shim's
  own object to listeners rather than rebuilding it. And `retrySend` passes libsession an empty
  upload handler, which it documents as "report nothing" rather than a handler that does nothing.
  `SendState` keeps `uploading` and `unsendable`: only attachments reach them, but they are
  libsession's states and the shim's switch has to name every one. This supersedes the 2026-09-04
  entry on the three wrong wire fields, two of which were `Attachment`'s.

- **2026-09-10 - The renderer's privileges are written out rather than inherited.** Every flag in
  `apps/desktop/src/main/security.ts` is already Electron's default. They are spelled anyway
  because a default is a decision someone else can change: an upgrade that flips one is a silent
  privilege grant to a window that draws message bodies from strangers. Beside them, a deny-by-
  default posture the app has no reason to relax yet - every permission refused, every navigation
  that is not the app reloading itself refused, `window.open` refused, and a CSP of
  `default-src 'none'` with `'self'` for the bundle. The CSP is a meta tag rather than a header
  because a packaged renderer loads over `file:`, where nothing carries one, and it is injected at
  build time because the dev server needs `'unsafe-inline'` for vite's react-refresh preamble and
  `ws:` for HMR - relaxations the shipped app must not have. Notifications are the first permission
  this will have to grant, and `security.ts` is where that decision goes.

  Electron's fuses - `runAsNode`, `nodeCliInspect`, `onlyLoadAppFromAsar` - are the other half of
  this and belong to a packaging step the repo does not have yet. `ELECTRON_RUN_AS_NODE` being set
  in this environment (above) is exactly the fuse that would refuse it.

- **2026-09-15 - A `Message` keeps its own `conversationId`.** Every container already establishes
  it: a `message-added` names the conversation beside the message, and a `messageList` answers a
  request that named one. The protobuf bridge dropped the field for the bytes it saved, which is
  not the argument here - the shim builds JSI and N-API objects, so what repeats is a string per
  row rather than 66 bytes per row. Removing it means changing the protocol, the generated
  converters and the shim together, and every caller would then have to thread the id it asked for
  through the response.

- **2026-09-11 - A devnet is discovered from its seed node rather than written down.** The only
  devnet value configured is the seed node's oxend RPC. Every record libsession needs - an Ed25519
  pubkey, an IPv4 address and both storage ports, per node - is read from it at startup with
  `get_n_service_nodes`. A devnet regenerates those keys whenever it is rebuilt, so anything
  written by hand goes stale without saying so; that bug used to break iOS alone, because iOS was
  the only old client that needed the pubkey rather than a URL.

  Three things a devnet needs that the two public networks do not, all decided in the shim rather
  than configured, because none of them is a choice. Session Router refuses devnet outright, so a
  devnet routes over onion requests and does not exercise the routing path mainnet uses. Subnet
  diversity is off: a devnet is usually one machine, and path building will not put two nodes from
  a `/24` in one path, so left enforced it builds no paths and every request times out. And the
  file server has to be named, because only testnet has one of its own - an unconfigured devnet
  uploads to _mainnet's_, which is production storage reached over a sandbox, and the upload
  succeeds with nothing afterwards to show for it.

  `EXPO_PUBLIC_SESSION_FILE_SERVER_X25519_PUBKEY` is the server's X25519 key, which is what onion requests to
  it are encrypted with, not the Ed25519 one its QUIC endpoint is named by. Both are 64 hex
  characters, and the wrong one fails as a decryption error part-way through an upload.

- **2026-09-11 - Each network gets its own database directory.** `userData/<netid>/` on desktop,
  `documentDirectory/session/<netid>/` on mobile, so a devnet identity and a mainnet one coexist
  and switching back loses neither. libsession derives its snode cache from the database's
  directory, which puts a cache of nodes that do not exist on the other network on the right side
  of the split.

  A devnet with nothing configured attaches **nothing**, never mainnet: real traffic on a build
  whose owner believes it is a sandbox is the failure worth preventing, and an overlay stamping
  `devnet` over it would confirm the belief rather than contradict it.

- **2026-09-15 - Every attachment transfer is broadcast, not routed.** The protocol used to tag a
  report with the request id of the command that asked for it, so the facade could hand it to that
  command's callback. A download outlives the tap that started it and is drawn by a row that may
  not have existed when it began, so the report goes on the stream like any other event and lands
  in the store. `SessionEvent` stays one union and the facade keeps its plain fan-out. It is the
  one arm that is not whole state, because libsession stores none for a transfer in flight.

- **2026-09-15 - `Conversation.autoDownload` is optional, and unset is not `none`.** Unset means
  nobody has been asked what this conversation should fetch unprompted; `none` means they were
  asked and declined. Only the first should prompt, and calling the setter - with either answer -
  is what records that the question was put. The protobuf bridge collapsed the two and was wrong.

- **2026-09-15 - Nothing records whether an attachment is downloaded, and nothing should.**
  `Attachment` carries `uploaded` and `saved_at` and no local path, so after a restart there is no
  flag saying the bytes are cached. Asking for them is the answer, and it is better than a flag:
  a flag goes stale on an eviction or a pruned cache directory and this cannot. session-cli, on
  the same branch, draws a whole gallery this way - every tile calls `attachment_data` as it
  mounts. The cost is that a row offers "download" for a file already here and the tap is instant.
