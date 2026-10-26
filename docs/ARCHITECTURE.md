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

Colour and type live in `@session/theme-tokens` and are derived from a few authored knobs rather
than listed per theme; `docs/THEMING.md` is the map for that.

Nothing the apps store leaves the device: every file lives under a root that is protected and
excluded from backup, and on mobile only `src/storage/` may reach the file system.
`docs/STORAGE.md` has the roots, the platform mechanisms and what enforces them.

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
bytes do not. They leave by a second channel instead: `session-media://attachment/<id>/<index>`,
resolved natively by each platform straight out of `ClientBridge::fetch_media`, so a picture never
passes through JavaScript and never rides this stream. It answers from libsession's cache only:
nothing drawn on screen downloads, so a file arrives by libsession's own rule as its message does,
or by a tap. Whether the bytes are here is the
attachment's `availability` on the page. `downloadAttachment` reads the cache, joins a fetch
already running, or starts one. `exportAttachment` writes the file to a destination, fetching it
first if the cache does not hold it, and answers with where it landed: a collision lands at
`name (1)` unless the caller asked to replace.

The sender's placeholder is an image too, so it comes by the same road: `session-media://thumbhash/`
answers from `ClientBridge::fetch_thumbhash`, which decodes the ThumbHash on the attachment's row.
So does the thumbnail a tile draws: `session-media://thumbnail/` answers from
`ClientBridge::fetch_thumbnail`, the JPEG libsession made of a cached picture, from its cache only.
One authority per image rather than one URL with a flag, so a file and its stand-ins cache
separately, and nothing decodes an image in JavaScript on either platform. The sender's content type is a claim,
so desktop serves an attachment only when that type is on the viewable list and the leading bytes
are the same family, and every response carries a `sandbox` CSP: a file opened as a document gets
no script and no origin.

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

## Links leaving the app

Handing a URL to the operating system is where the app stops deciding what happens next, so
there is one place that does it: `openExternalUrl` in `@session/app`. The ports are not that
place. Each is a thin wrapper over the platform's own call - `shell.openExternal`,
`Linking.openURL` - and both give any scheme straight to the OS, so a policy written into one
of them is a policy the other two have to remember. A screen reaching for `linking.openUrl`
directly would skip whichever one it did not go through.

Desktop checks a second time in its main process. That is a different boundary rather than a
duplicate: the main process does not trust the renderer, while the shared check is the app
deciding what it is willing to open at all. Files written and revealed have a main-process check
of their own, for the same reason; see the 2026-09-29 entry in the decision log.

**A missing scheme becomes `https` rather than a refusal**, and only where the text already
looks like a host. Both mobile clients do this, and both pick https rather than the http a
parser would default to, because https is the only scheme they will load a preview for.
Somebody who typed `getsession.org` meant a website. A scheme that is present and is not
http(s) is refused rather than upgraded: `file:`, `javascript:` and `mailto:` say what they
are.

**Plain http is allowed.** All three clients open it, and refusing it here would be stricter
than anything shipped.

### Where the addresses come from

The addresses themselves are libsession's. `session_protocol_strings` in the submodule holds
twenty-odd of them, and `packages/app/scripts/generateUrls.ts` reads that table into the `URLS`
in `urls.generated.ts` at codegen time. `codegen:check` fails while the two disagree, and a
contract test fails if **any** address is written out in the app's own code. A new outward address
goes into libsession first, so there is one list and everything reads it.

**There is no curated second list.** A hand-kept subset of the table would be a rename layer over
it, and one that also decides which addresses a screen is allowed to reach -- so an address the
library has and the list has not is unavailable for no reason anybody stated.

**Build-time rather than over the bridge.** The table is a static const - no client, no network,
no account - and the consumers read `URLS` at module scope. Carrying a constant over the frame
stream would make it state, and the stream exists to carry libsession's ordering of state
changes, which a constant has none of.

**A synchronous native read is not available here**, which is what the iOS client does. The addon
lives in the desktop main process and the renderer reaches it only over the preload bridge, so the
process that draws the screen cannot read the library at all. Generating covers both platforms
with one mechanism; a native read would cover one.

**CI does not verify the table against the library**, and the generator says so rather than
passing quietly: the checks job leaves libsession-util out, since it drags in protobuf and
session-deps and nothing there compiles C++. The check enforces wherever the submodule is present,
which is every developer tree. What holds in CI is that the generated file is committed and so
reviewable, and that the contract test reads it rather than the library.

### Addresses that are not what they read as

A scheme check says a link may be opened. `isPlausibleAddress` says it is what it looks like,
and every entry in it is a way of writing an address that renders as one destination and
resolves to another:

| refused                                       | because                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| userinfo before the host                      | `https://getsession.org@evil.example` goes to `evil.example`         |
| one label in two scripts                      | Cyrillic `а` for Latin `a`, inside a word -- so `session.рф` is fine |
| a percent-encoded host                        | `%67` is `g`, so a host can be spelled to defeat a reader            |
| fewer than two labels, or any empty one       | not a host                                                           |
| over 4096 characters, or a host over 2048     | not a readable address either way                                    |
| anything outside RFC 3986 after the authority | how a control character reaches what is displayed                    |

The list is the legacy desktop client's, which applies the same one to opening and to previews
and is the only one of the three clients that has it.

**Two limits worth knowing.** It is written against the string rather than a parsed `URL`,
because react-native ships an incomplete one - `username` in particular - and a check built on
it would quietly pass on the platform with the least protection elsewhere. And the
mixed-script test reads the host as written: one already encoded as punycode is pure ASCII and
passes unexamined, which would need a decoder neither Hermes nor a browser exposes. Text
arriving from a message body is the unencoded form, which is the case that matters.

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

A tamagui token that does not exist resolves to **0, in silence**. `padding="$smal"` on a scale
that names its steps `sm` loses the padding; `color="$textPrimry"` paints nothing. TypeScript does not help -
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

## The build graph

`turbo.json` carries no comments. Turbo accepts them, but the file is read by more than turbo --
editors, GitHub, any tool that loads it as the JSON it claims to be -- and JSON has no comment
syntax. So the reasons behind its less obvious entries live here instead.

- **`packages/bridge-types` is an input to the bridge codegen even though no codegen task reads it
  directly.** A nitro spec imports its types from there, so the generated C++ follows that package's
  shape. Left out, the cache key does not move when it changes, and turbo _restores_ the stale
  generated files over the correct ones -- reverting a committed regeneration with nothing said.
- **`@session/app#codegen` is never cached.** CI does not check out libsession-util, so the two
  submodule files it reads are absent there and its key could not move on a bump: a cache hit
  restored the previous URL table over the committed one, and every check then ran against a table
  that was not the one being merged. It runs in milliseconds, so caching bought nothing.
- **The committed URL table is an input of the task that writes it.** In CI the generator stands
  down and the committed file _is_ the table, and a task's hash is what reaches the tasks depending
  on it. Without it the generator's hash never moved, so a package whose `test` depends only on
  `^codegen` could replay a pass from before a bump.

**CI fails if a run changes any committed file.** A cache hit must never rewrite one, so the last
step of the checks job compares the tree against the commit. It catches a stale restore by its
effect, whatever the cause -- including in generated files nobody has written yet.

**`tooling/turbo-guard` checks the cause before anything runs**, as part of `lint:manifests`. It
takes the tasks CI's checks job starts, asks turbo for their run graph, and refuses a cached task
with an input under a submodule CI does not check out, or a generator with such an input whose
committed output is not also one of its inputs. It models CI's checkout rather than the local one,
so it gives the same answer in a tree with every submodule present. The second rule is the only
guard for its case: a dependant replaying a stale result leaves the tree untouched.

**It also refuses a `@session/*` import the importing package does not declare.** Nothing else
sees one: the hoisted layout links every package at the root and tsconfig paths map the siblings
to their source, so typecheck and lint resolve it and pass. A bundler resolving from the package
itself does not, and turbo is wrong before that -- `^build` and a task's cache key follow the
declared graph, so an undeclared sibling is neither built first nor hashed.

- **`@session/localization` is built before anything is lint-checked with types.** It is consumed
  as built output, so its declarations have to exist first. Without them the typed rules do not
  fail -- they go blind: `tr()` resolves to the error type and every rule touching it reports
  "could not be resolved" instead of checking anything.

## Building the native side

Two things cost real time on a first clone, and neither is discoverable from a failure message:

- **libsession-util's submodule tree is 37 deep.** `--reference
~/pro/contribs/libsession-util/.git/modules/<path>` per submodule borrows the objects already on
  disk; a plain recursive init downloads about a gigabyte.
- **gmplib.org drops connections often enough to matter**, and it is where gmp comes from.
  `-DLOCAL_MIRROR=https://builds.session.codes/deps` is tried ahead of every dependency's own
  mirror, so one flag takes the whole static build off the upstream hosts rather than just gmp.
  The desktop and Android builds always pass it; the hashes are checked either way.

Which compiler, and why, is in the decision log. How to build and run each client is the `run`
skill's.

## Environment split

Each shared package typechecks with `types: []` and no DOM, so a stray `window` is an error.
The two apps then re-check the same sources: the desktop renderer under a browser lib, the
mobile app under react-native's types with `moduleSuffixes` resolving the `.native` variants.
Every shared file is checked two or three ways per run, with no synthetic profiles to maintain.

## Decision log

Append one paragraph per decision. Undocumented decisions are what rot.

- **2026-10-08 - Mobile exports go where the legacy clients put them.** libsession writes the
  export into the app's cache, the files port admits only that staged path, and the staged file
  is then handed on:

  | platform     | a picture or video      | a sound | anything else              | asks for                 |
  | ------------ | ----------------------- | ------- | -------------------------- | ------------------------ |
  | Android 10+  | Pictures / Movies       | Music   | Download                   | nothing                  |
  | Android 8, 9 | Pictures / Movies       | Music   | Download                   | `WRITE_EXTERNAL_STORAGE` |
  | iOS          | Photos (3GPP: a folder) | folder  | a folder, picked each time | add-only Photos access   |

  Android files by the MIME type the name implies, as legacy Android's `SaveAttachmentTask` does,
  so a name whose type a media collection refuses goes to Download. From Android 10 the row is
  inserted pending and published once the copy is whole: no other app sees a half-written file,
  and MediaStore numbers a name already taken. A row the app dies before publishing expires after
  a day on 10, where the app sets the expiry and clears it on publish, and after a week on 11 and
  up, where MediaStore does both; idle maintenance then deletes it. On 8 and 9 the same public
  folders are written directly, under a hidden temporary name renamed once whole, then scanned,
  and the scanner's `content://` URI is what is opened afterwards. Without the grant there is
  nowhere to write, so any refusal ends the export with the dialog that leads to the settings;
  legacy shows that dialog only once the OS stops asking, and toasts before. iOS copies into the
  picked folder under a temporary name renamed into place; Photos refuses 3GPP, so that goes to a
  folder.

  A file the sender did not name is suggested as `Session_<yyyy-MM-dd-HHmmss>` in local time from
  when the message was sent, `_<n>` added for the n-th attachment from the second on, plus the
  extension its declared type calls for, as legacy Android names one; a named file with no
  extension gets that extension. Android files by extension, so a sound without one would land in
  Download, and MediaStore stops numbering a name after about 32 copies, so the suggestion has to
  differ between messages.

  Not a folder picker on Android. The Storage Access Framework hands the write to whichever
  provider was picked, and a provider may refuse a rename, refuse a delete, or advertise a rename
  it then refuses. Against a provider built to do each, a temporary name either failed the export
  or left an empty file behind. MediaStore is one implementation with one behaviour on every
  version, and is where users of the legacy client already find their files.

  Deliberately unlike legacy: on 8 and 9 legacy filed pictures and videos in the app's own
  external folder, which uninstalling deletes; these go to the public folders. A duplicate there
  is numbered `name (1)`, as MediaStore numbers one from 10, rather than legacy's `name-1`.

- **2026-09-29 - Desktop main admits an export only to the path its dialog returned.**
  `save_attachment` writes wherever it is told, with no containment of its own, and
  `showItemInFolder` acts on any path, so the renderer is held to what a save dialog answered. The
  answer is a one-shot grant for that exact path, kept by the window whose dialog it was and spent
  by the export it admits. Main sets
  `replace` from whether a file was already there when the dialog returned, since every platform's
  dialog asks before an existing name is chosen, and ignores what the request said. A reveal is
  allowed only for the path an admitted export reported landing at, which is where libsession put
  the file whatever it was asked for.

  By exact path rather than by folder: a folder grant turns one answer into a licence to create or
  overwrite any name in that folder for the rest of the run. Nothing is persisted: a path chosen in
  an earlier run is not one this run has any reason to reach.

  The shim marks every exported file as downloaded from the internet - Mark-of-the-Web on
  Windows, the quarantine property on macOS - because it is a stranger's file written by plain
  file I/O, which no operating system check would otherwise see.

- **2026-09-23 - Every outward address lives in libsession.** One source of truth, rather than
  libsession's table plus whatever the app adds beside it. The contract test enforces it by refusing
  any address literal in app code, not only copies of ones the table already holds, which makes
  adding an address upstream the only way to add one. The bare website address is the single
  exemption, and only until the submodule carries `url_website`.

- **2026-09-22 - The outward addresses are generated from libsession, not written here.** One
  table upstream, read at codegen time and committed, so a checkout without the submodule still
  typechecks and `codegen:check` is what stops it drifting. Not delivered over the bridge: a
  static const is not state, and the stream's value is its ordering. Not read natively either -
  the desktop renderer has no addon, so that shape covers mobile only. See _Where the addresses
  come from_.

- **2026-09-21 - A packaged desktop build ignores every developer setting, not just the fake.**
  Switching a shipped build to a devnet is a smaller thing than running it on the fake, and
  neither has a use that has come up. The ones that turn out to be worth reaching belong in
  settings the app offers on purpose, where they can be shown and explained, rather than in an
  environment variable nobody can see. A release build carrying one fails rather than baking it
  in, because the renderer's copies are substituted at build time and would otherwise disagree
  with a main process that ignores them.

- **2026-09-21 - One shared check decides what may be opened, not the ports.** Handing a URL out
  is the moment the app stops deciding what happens next, and a port is a thin wrapper over the
  platform's call: a policy in one is a policy the other two must remember. Desktop keeps its
  main-process check, which is a different boundary rather than a duplicate. See _Links leaving
  the app_.

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

  `EXPO_PUBLIC_SESSION_FILE_SERVER_ED25519_PUBKEY` is the server's Ed25519 key, which its QUIC
  endpoint is named by; libsession derives the X25519 key onion requests to it are encrypted with.
  Both are 64 hex characters. The bridge refuses an X25519 key at start when it is no Ed25519
  point, about half the time; otherwise uploads fail at the server.

- **2026-09-11 - Each network gets its own database directory.** `userData/<netid>/` on desktop,
  the storage module's `data` root on mobile (`<root>/<netid>/`; see `docs/STORAGE.md`), so a devnet identity and a mainnet one coexist
  and switching back loses neither. libsession derives its snode cache from the database's
  directory, which puts a cache of nodes that do not exist on the other network on the right side
  of the split.

  A devnet with nothing configured attaches **nothing**, never mainnet: real traffic on a build
  whose owner believes it is a sandbox is the failure worth preventing, and an overlay stamping
  `devnet` over it would confirm the belief rather than contradict it.

- **2026-09-15 - Attachments over the bridge.** Metadata, transfer progress and the
  per-conversation auto-download setting cross; bytes do not. This supersedes the 2026-09-08 entry
  that took attachments out of the protocol.

  A transfer's progress is broadcast on the stream, not routed to the command that asked for it. A
  download outlives the tap that started it and is drawn by a row that may not have existed when it
  began, so the report lands in the store like any other event, `SessionEvent` stays one union and
  the facade keeps its plain fan-out. It is the one arm that is not whole state: a report is one
  transfer's progress, and a screen that missed some reads `availability` and the fetch figures
  from the page instead.

  `Conversation.autoDownload` is optional, and unset is not `none`. Unset means nobody has been
  asked what this conversation should fetch unprompted; `none` means they were asked and declined.
  Only unset prompts, and calling the setter with either answer is what records that the question
  was put.

  Nothing stores whether an attachment is downloaded. Each attachment on a page carries its
  `availability` and, while it is fetching, how far it has got, so a screen that was not listening -
  the conversation closed, the renderer reloaded, the process restarted - is right from the page
  alone, and there is no flag for an eviction or a pruned cache directory to make stale.

  Bytes leave by `session-media://`, not by the frame stream. A decrypted attachment is not state,
  so no event can contradict it, and a multi-megabyte payload on a FIFO stalls every state frame
  behind it. `ClientBridge::fetch_media` answers its own caller, and a renderer gets a URL its
  platform resolves: `protocol.handle` on Electron, an image loader per platform on mobile. The
  codegen subset never needs a bytes primitive. A standard scheme gets the special-scheme host
  parser, so `session-media://5/0` would canonicalise to the host `0.0.0.5`, hence the fixed
  `attachment` authority with both ids in the path. And tamagui's `Image` passes `source` through as
  a DOM attribute, producing an `<img>` with nothing to load, so `@session/ui`'s wraps
  react-native's, which react-native-web turns into something that fetches.

- **2026-09-16 - A history window lives as long as its screen.** `useMessages` drops
  `histories[id]` when it stops showing that id, and the transfers of the messages it held go with
  it. Keyed on the id rather than on unmounting, because a wide layout keeps the detail pane
  mounted and only swaps the prop. The store is then a view of what is on screen, so a progress
  report for a message no window holds is dropped. The cost is that returning to a conversation
  reloads it and loses paging depth and scroll position, which is in `STATUS.md`.

- **2026-09-28 - Mobile resolves `session-media://` in a native image loader per platform.**
  `MediaPort.urlFor` stays synchronous and the URL stays the request, so the bytes never enter
  JavaScript: the loader recognises the scheme, asks the shim, and hands the platform a decoded
  image. Android's is a Fresco producer sequence and iOS's an `RCTImageURLLoader`.

  Rejected for Android: a non-exported `ContentProvider` and a `content://` URL, which is what the
  legacy client does and would serve Glide and Media3 too. Fresco reads a content URI
  synchronously on a two-thread executor, so two pictures still downloading would stall every
  local image in the app.

  The URL builder moved to `@session/app/mediaUrl`, one for all three platforms; the handlers did
  not. Both mobile loaders are native and share the shim, so the parser and the servable check -
  the declared type viewable and the leading bytes that family - are C++ in `bridge-core`
  (`media_url.hpp`), with desktop keeping its TypeScript pair for `protocol.handle`. One vector
  table in `@session/client-contract` holds both languages to the same answers. The grammar is the
  canonical form only, because Chromium canonicalises before a handler sees a URL and a native
  loader is handed the one the app built.

  The Nitro bridge has `fetchMedia`, `fetchThumbnail` and `fetchThumbhash` as the addon does,
  returning `ArrayBuffer`s the client views as `Uint8Array`, so the transport has one shape and a
  device-side contract run can assert bytes. Nothing in the app calls them. The fake answers the
  same `MediaSource` contract through `createFakeMediaSource`. Video is out of scope until a tile
  has a still on any platform.

- **2026-09-30 - Android draws `session-media://` through a Fresco producer sequence.**
  A `CustomProducerSequenceFactory`, installed by a config plugin that rewrites the generated
  `MainApplication` to build `PackageList(this, SessionMedia.packageConfig(this))`: nothing
  initialises Fresco before React Native's `FrescoModule`, and a config handed in replaces React
  Native's default, so `ReactFrescoDefaults` rebuilds what that default sets - the OkHttp fetcher
  with React Native's cookie jar, `DownsampleMode.AUTO`, the Systrace listener. The sequence is
  Fresco's own decoded sequence minus every disk-cache producer, so decrypted bytes only ever sit
  in the encoded and bitmap memory caches. A project generated before the plugin compiles the
  loader and never installs it, so the package checks Fresco's factories once the React instance
  is up and refuses in a debuggable build.

  A loader reaches the bridge through a process-wide media source the Nitro bridge registers and
  clears before it closes. `close()` detaches the source under its lock before destroying the
  bridge, and every fetch holds that lock, so a load in flight never reaches a freed bridge. The loader does not wait on the network: it starts the fetch and
  returns, the answer arrives on Core's loop and is handed to a thread the loader owns, which
  copies the bytes into Fresco's pool. The gate is `servable_image_type`: a video is servable to
  desktop's `protocol.handle`, but no picture decoder may be handed one. Thumbhashes are RGBA handed
  over as a bitmap rather than encoded; only desktop encodes, because `protocol.handle` answers
  with a body. The fake has no libsession behind it, so `serveMediaFrom` lets JavaScript be the
  source: each load is posted to the JS thread, the only thread that may touch a JavaScript value,
  and the host test holds that under ThreadSanitizer.

- **2026-10-01 - iOS draws `session-media://` through an `RCTImageURLLoader`.** Registered
  through `codegenConfig.ios.modulesConformingToProtocol`, which Expo's `RCTAppDependencyProvider`
  hands to React Native. The answer, on Core's loop or the JS thread, is handed to a concurrent
  queue the loader owns, which runs `servable_image_type` and hands ImageIO the shim's bytes in
  place, held by an `NSData` deallocator. A still is decoded there into a new bitmap, with the
  file's orientation applied, and never past one pixel-area budget, whatever the view. That bounds
  the result, not the decode: ImageIO holds a GIF or PNG whole before reducing it, so one whose
  header area is past a 100 MP ceiling is refused and draws as failed. A GIF
  of more than one frame whose canvas fits that budget is an `RCTAnimatedImage`, which keeps the
  shim's bytes and decodes each frame whole at draw; any other GIF is its first frame, decoded as a
  still. Nothing is written to disk: a URL loader is not behind `NSURLCache`. React Native caches
  only the images it decoded itself from an HTTP response, so the loader keeps its own cache of
  decoded thumbnails and thumbhashes, keyed by URL (and a thumbnail's by the view's pixel size too),
  and leaves out originals, which only the viewer draws and which would take most of its budget.
  React Native reports a failed load only to the view's `onError`, so the loader logs each one with
  its URL. The fake
  registers itself as the source with `serveMediaFrom` on both platforms, so it draws through the
  real loaders.

- **2026-10-09 - A media URL names one attachment for the life of one database.** libsession
  never hands a message id out twice within a database, so `session-media://attachment/<id>/<n>`,
  its thumbnail and its thumbhash can be cached by URL for as long as that database is open. A
  discard opens a new one numbering from 1 again, after which every URL cached before it names some
  other message. The bridge calls `InitOptions::on_database_replaced` after every discard, the
  startup sweep's included. Mobile empties its loaders' caches there: Fresco's bitmap and encoded
  memory caches on Android, the loader's cache of decoded thumbnails and thumbhashes on iOS. Desktop
  empties nothing, because Blink caches the scheme's responses where main cannot reach them; it
  relies on the process ending instead. Settings > Clear data ends the process, and so does the
  clear offered when the database will not open if an account had been loaded, which is where a
  failed Settings > Clear data lands. Onboarding's back, that clear at launch and the startup sweep
  all come before any media is drawn. A decode answered just before a mobile reset can still land
  after it and cache the old picture again, which the same ordering keeps latent. A discard that can
  follow drawn media in one process needs a per-database epoch in the URL instead.

- **2026-10-09 - A tile draws libsession's thumbnail; only the viewer draws the file.**
  libsession makes a square JPEG of each displayable picture it caches - cropped to cover, EXIF
  orientation applied, first frame of an animation, alpha on a checkerboard, quality 90 - on a
  worker, and reports it as `Attachment.hasThumbnail` in a later `messages-updated`. Its side is at
  most the client's thumbnail edge, which each app opens the bridge with as `ALBUM_WIDTH` times its
  display density and `setThumbnailEdge` can store over, clamped to 64-1024 so a decoded one stays
  within 4 MiB. It lives in the original's cache entry and is evicted with it. Generating it there
  rather than in each loader gives every platform the same picture from one decoder, libvips under
  libsession's own loader whitelist, and leaves the loaders two paths: a thumbnail, checked to be a
  JPEG and reduced while decoding but never below its view, a file row's glyph far less than a tile
  (Fresco's decoder and downsampling on Android, the same as an original's, asked for 4/3 the view
  because Fresco's JPEG sample can land up to that far below its target; ImageIO's maximum pixel
  size on iOS, only where the view needs half of it or less), cached by URL and view size; and the
  viewer's original, which keeps the pixel budget, the GIF/PNG refusal, animation and Fresco's
  downsampling. Drawing never starts a download: a tile's URL used to be the original's, and
  resolving it fetched the file, which under `image-attachments` or `all` spent data on any older
  message that scrolled past. Now every URL is served from the cache only (`attachment_data_cached`,
  refused as "is not downloaded"), and a file arrives only by libsession's own rule when its message
  does, or when somebody taps. This supersedes the 2026-09-15 entry's sentence on progress: drawing
  a picture reports none. A viewer whose file was evicted just before it loaded draws its
  unavailable state rather than downloading again. A tile has no failed face: a thumbnail exists
  only of a picture that decoded, so one that does not load was evicted under it and the placeholder
  is the truth. The fake serves thumbnails `pnpm fake-media:fetch` makes of its dev photographs at
  720 px.
