# Device logs

What the app writes about itself, where, and how an identifier is kept out of it. The code is
`packages/logging`; each app opens its directory at its entry (`apps/desktop/src/main/logs.ts`,
`apps/mobile/src/logs.ts`) and hands the logger to `startLogger` in `@session/app`.

Logs are plain text in app-private storage. Nothing sensitive is meant to be in them, and that is
enforced by the types below and a sweep over every line, not by encryption.

## The line

Every line starts with a **fixed-width, 79-column prefix**, so the eye can skip straight to column 80:

```
2026-10-09T00:18:07.718Z      +0.928 INFO  [network]          [CoS-0-I7C3]     Starting clock resync. src=network/session_network.cpp:963
2026-10-09T00:18:07.720Z      +0.930 INFO  [session]                           no account on this device yet
2026-10-09T00:18:09.201Z      +2.411 INFO  [session-router]   [CoS-0-I7C3-2]   No tunnel to ~e2b47d22, initiating new tunnel. src=routing/session_router_router.cpp:610
└──────── 24 ───────────┘ └─ 11 ──┘ └ 5 ┘ └────── 18 ──────┘ └───── 16 ─────┘ message, key=value
```

| column        | width             | content                                                                                                                                                                                                                                                                  |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UTC timestamp | 24                | millisecond, with `Z`                                                                                                                                                                                                                                                    |
| uptime        | 11, right-aligned | `+seconds.mmm` since process start; monotonic, so intervals survive a clock step. Aligned on the decimal point. Past 11.5 days it grows by a column rather than wrapping                                                                                                 |
| level         | 5                 | `TRACE DEBUG INFO  WARN  ERROR CRIT` — a word, never collapsed                                                                                                                                                                                                           |
| category      | 18                | `[network]` padded after the bracket. Up to 16 characters fit whole; a longer one is cut to its first 15 and `…` (`[onion-request-r…]`), so the columns after it never move whatever names libsession or its dependencies add. Grep a cut one by its start               |
| op            | 16                | the request one line belongs to, or blank: libsession's request id `[CoS-0-I7C3]`, which it puts on every line of a request under every transport and the app moves here from the message. A request's own sub-requests add `-0`, `-1`, …, so the bare id finds them all |
| message       | rest              | the event, then `key=value` pairs: **values, not conclusions** (`present=false destroyed=true`, not "group is gone"). Newlines escaped as `\n`                                                                                                                           |

**`~` is a pseudonym** of a real identifier (keyed hash, same input → same pseudonym for as long as
the logs are kept). A request id needs no sigil: it is libsession's own, minted per request, and
identifies nothing outside the run.

## Identifiers: redaction is a property of the type

The logger's structured API takes values of a closed set of types. Free text is allowed only as the
message, and it passes a backstop sweep. **The raw form of an identifier is unreachable from a log
call**: each type holds its input in a private field with no accessor, so a log call can hand one
over but never reach back through it. Nothing stops a raw string being written into a message;
that is what the sweep below is for.

| kind                         | renders as                                                                   | examples                                                                                                                                                                                           |
| ---------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **never logged**             | no typed value carries it; in free text, only the sweep stands in the way    | message bodies and drafts, attachment filenames, display names, recovery phrases, seeds, private/config keys, whole UI state, raw URLs                                                             |
| **user-visible identifiers** | prefix + 4 + 4, ASCII: `05ab12...cd90`                                       | account IDs, group IDs: the reporter can match either end against what the app shows                                                                                                               |
| **internal identifiers**     | pseudonym `~3fa9c1de`                                                        | service-node keys, swarm message hashes, server file IDs, container/install UUIDs. Support needs equality across lines, never the value. Keyed with a random per-install salt kept beside the logs |
| **network addresses**        | family + class + port: `v4 public:22021`, `v6-mapped private:443`            | never the octets; the device's own address is never logged                                                                                                                                         |
| **URLs**                     | scheme, host, path shape — see below                                         |                                                                                                                                                                                                    |
| **paths**                    | the semantic name: `config-dump(user_groups)`, `db`, `attachment(~5d0e116f)` | never a container UUID or a filename                                                                                                                                                               |
| **free**                     | as is                                                                        | counts, sizes, durations, states, namespaces, levels, error codes, config type names, seqnos, UTC offset, locale                                                                                   |

Address classes: `loopback`, `private` (RFC 1918, ULA, link-local), `cgnat` (100.64/10), `public`,
`unspecified`. Families: `v4`, `v6`, `v6-mapped` (an IPv4 address carried in IPv6).

URLs keep their shape and lose what identifies:

- **scheme** as is;
- **host** in clear only if it is Session's own public infrastructure (seed nodes, the file server,
  the push server, the Session Network API) — a fixed allowlist in `packages/logging`. Any other host
  is a pseudonym: a community server says which communities someone is in;
- **path**: on an allowlisted host, segments that look like ids (≥ 16 characters of hex or base64, or
  ≥ 6 digits) become pseudonyms; on any other host, every segment does except a fixed vocabulary
  (`room`, `file`, `files`, `messages`, `since`, `capabilities`, `batch`, `sequence`, `pin`, `reactions`);
- **query**: dropped, replaced by its parameter count (`?<2>`); a community link's `public_key=` lives
  there;
- **fragment**: dropped.

One ellipsis form in a shortened identifier, ASCII `...` (legacy iOS writes `...`, Android `…`;
not `..`, which legacy iOS rewrites to `.`).

**Backstop sweep** over every rendered line, before it is written; each match replaced by its
redacted form and counted (the counts go in the export header): URLs; UUIDs; hex runs of **32 or
more** (a 66-hex prefixed key becomes its user-visible form, anything else a pseudonym); base64 runs
of 40+ with mixed case; **lowercase base32 runs of 50+, keeping a `.sesh`/`.snode` suffix** (Session
Router and service-node addresses — a real testnet run showed the client's own router address
reaching the file before this rule); IPv4/IPv6 literals; runs of 13+ words of 3–16 letters, the
range libsession's word lists span (Latin and Cyrillic; a phrase in another script is a known gap).
libsession's lines are free text from C++, so they are swept like any other line.

**A message is cut to 4,096 characters before it is swept**, since the sweep's cost grows with the
text and nothing written for a person runs that long. Where the cut falls inside a run of
non-space characters the whole run goes, so it can never leave part of a key too short for the sweep
to recognise; the line ends `[cut N chars]`.

## Following things through a log

**One request, end to end** — grep the request id. A clock resync asks three nodes at once, each
a sub-request of its own:

```
2026-10-09T00:18:07.718Z      +0.928 INFO  [network]          [CoS-0-I7C3]     Starting clock resync. src=network/session_network.cpp:963
2026-10-09T00:18:08.720Z      +1.930 INFO  [network]          [CoS-0-I7C3-0]   Launching clock resync request to ~3c741c13 src=network/session_network.cpp:990
2026-10-09T00:18:09.203Z      +2.413 INFO  [session-router]   [CoS-0-I7C3-0]   No tunnel to ~3c741c13, initiating new tunnel. src=routing/session_router_router.cpp:610
2026-10-09T00:18:09.862Z      +3.072 INFO  [session-router]   [CoS-0-I7C3-0]   Tunnel to remote ~3c741c13 established. src=routing/session_router_router.cpp:1315
2026-10-09T00:18:09.862Z      +3.072 INFO  [quic-transport]   [CoS-0-I7C3-0]   No connection to ~3c741c13, initiating new connection. src=transport/quic_transport.cpp:272
```

`grep 'CoS-0-I7C3'` gives the resync and all three of its requests; `grep 'CoS-0-I7C3-0'` one of
them; `grep '~3c741c13'` every line that ever named that node, across requests and across the files
of one install (same salt). Path hops are written as Session Router writes them, `55fxy4hj`: paths
rotate every 20 minutes, so a hop says little, and it is what reading a path failure needs.

**A path that goes bad on a private network** — the class is what support needs, never the octets:

```
... WARN  [quic]                              connect failed dest=snode~c41b0707 addr=v6-mapped private:22021 errno=EHOSTUNREACH ms=3004
```

**A file download** — the server is Session's own, so its host stays; the file id is a pseudonym, which
the attachment's own lines carry too:

```
... INFO  [attach]                            download start url=https://filev2.getsession.org/file/~5d0e116f msg=~77a0c357 bytes=245812
... INFO  [attach]                            download ok ms=1204 path=attachment(~5d0e116f)
```

**A community poll** — the server is not Session's, so its host is a pseudonym, room names too; the
query is only counted:

```
... INFO  [community]                         poll url=https://~a91f0c1d/room/~e02d4baf/messages/since/~41f0aade?<1> status=200 msgs=3 ms=388
```

`grep '~a91f0c1d'` follows one community server across every room and every poll without saying
which it is.

**An account, as the reporter sees it** — user-visible ids keep both ends, so a screenshot of the app
can be matched to the line:

```
... INFO  [send]                              send start to=05ab12...cd90 kind=text attempt=1
```

## Files

- `logs/` under app-private storage, never backed up: desktop `userData/logs`; mobile the storage
  module's `logs` root (`<app group>/logs` on iOS, `filesDir/logs` on Android). See
  `docs/STORAGE.md`.
- **Names, no spaces:** `session-<UTC basic>-<n>.log`, e.g. `session-20261008T032009Z-0.log`.
- **A new file at every launch**, so "the previous run" is a file and a crash's run is never mixed
  into the next one.
- **Rotate by size, never age:** a file closes at 2 MiB; the store keeps the newest files up to
  ~20 MiB and deletes the oldest whole file. Nothing is truncated mid-file.
- Writes buffered, flushed at least every 2 s and on background / window close. Unmissable markers
  flush at once.
- **On the desktop, main sweeps and writes every line.** libsession's are logged in main, where the
  addon delivers them, rather than sent to the renderer and back. The renderer's own lines go to
  main as records (level, category, message, typed fields, time) at the end of the task that logged
  them, so the thread that draws the app never runs the sweep and never holds the pseudonym key,
  and nothing waits in the renderer for a closing window or a restart to lose. Main holds each line
  for a second and writes them in the order they were logged, so the two processes' lines
  interleave by time; a marker or error goes at once. Quitting waits (up to half a second, after
  the windows close) for every line still held, libsession's last ones included, to reach the
  disk.
- **On the phones, everything is swept on the JS thread**, libsession's lines included, until native
  redaction (M349) can take them before they reach it.
- **The log never depends on the database or its key.** If the directory can't be opened, the
  logger writes to the console instead and says why there.

## The startup block (top of every launch)

Written **without** the line prefix, after an empty line, one item per line:

```
2026-10-09T07:40:58.002Z      +3.811 INFO  [lifecycle]                         >>> background

── Session 1.0.0 (123) launched 2026-10-09 07:41:02Z
  Version        1.0.0 (123)
  Commit         833d55d5
  libsession     76d93c51
  Variant        testflight
  Install        unknown
  Device         iPhone (model unknown)
  OS             iOS 26.1
  Time           en-AU · UTC+10:00
  Network        mainnet
  Transport      Session Router (default)
  Flags          none overridden
  Log level      info,network=debug
  Previous run   session-20261009T011544Z-0.log, ended cleanly
2026-10-09T07:41:02.130Z      +0.412 INFO  [lifecycle]                         >>> launch
```

- **The empty line** sets one launch apart from the last when scrolling, without a rule that would
  compete with the export's header. `grep -n '^── Session'` lists every launch in a file or an
  export, and splitting on it cuts a log into runs.
- **The libsession commit** is stamped at build time from the submodule, like the app's: libsession
  is the client, so a report has to say which one. Where the submodule was never checked out (a
  JS-only CI build), it is the commit the app pins.
- **Time** is the locale and the UTC offset together; no time-zone name, no region.
- **Network and transport** are read where the bridge is opened, not from what the renderer was
  built with, so a dev run says what it is actually attached to. Seed node and file server follow
  when they were set.
- **Flags** names each flag the build's environment sets, with its value as written
  (`debugMode=ture` reads as the default, and the row shows why), then any
  `EXPO_PUBLIC_SESSION_FLAG_` variable that names no flag, so a misspelling shows too.
- **Log level** is `EXPO_PUBLIC_SESSION_LOG` as written, the one spec that sets both what
  libsession emits and what the file keeps. It only adds detail: every category is kept at `info`
  and above, and at a more verbose level where the spec names one for it or as its bare level, so
  `warn,network=debug` quiets libsession's other categories without dropping the app's own lines.
- **Platform rows:** Linux adds Distro, Display (Wayland or X11), Desktop and Packaging (AppImage,
  Flatpak, Snap, or `dev` for a run that was never packaged; a .deb, an .rpm and a tarball say
  `unknown`), and gives the kernel as its OS version. macOS and Windows give their version.
- **Desktop's main process writes the block**, so it opens the file and is there even when the
  renderer never loads. The renderer marks its own launch (`>>> launch process=renderer`).
- **"Previous run … ended cleanly"** comes from the markers: a previous file whose last marker is
  not a background or a quit says that run died, which is the first thing support asks.
- **On Android 11 and later the row adds the system's own record** of how the previous process
  ended, from `ActivityManager.getHistoricalProcessExitReasons`: `…, exit: low memory`, `crash`,
  `ANR`, `user requested`, `app updated`, with the system's description in brackets where it gives
  one. A record older than the previous file's launch belongs to an earlier process and is left out.
  This is the answer the memory marker cannot give from Android 14 (below).
- **An iPad build running on a Mac** says `macOS (iPad app) <version>` in the OS row, here and in
  the export. There is no Catalyst build, so that is the only way the app runs on a Mac.

## Unmissable markers

Never sampled, rate-limited or level-filtered, flushed at once: `launch`, `foreground`,
`background`, `quit` (where the platform says, and Quit on a phone), `restart`,
`start ok|failed reason=…`, `account loaded|none|created`, `memory warning`, `renderer gone` and
`child process gone` with Chromium's reason (desktop), and `export`. Their absence is then evidence.

`memory warning` comes from iOS's memory warning, and on Android from `onTrimMemory` at the levels
that mean the system is short of memory (`running moderate|low|critical`, `moderate`, `complete`)
or `onLowMemory`. **Only Android 13 and below send those levels**: Android 14 and later send only
`UI_HIDDEN` and `BACKGROUND`, and `BACKGROUND` is left out because it fires every time the app goes
to the background. On Android 14 and later the Previous run row's exit reason says what the marker
would have.

## The export

**Header**: a document block at the top of the file, wrapped in full-width `=` rules so it can't
be mistaken for a launch, one item per line, with lists nested under their heading:

```
====================================================================================================
Session logs exported 2026-10-09 07:41:02Z (17:41 local, UTC+10:00)
====================================================================================================
  Version        1.0.0 (123)
  Commit         833d55d5
  libsession     76d93c51
  Variant        testflight
  Install        testflight
  Device         iPhone17,1
  OS             iOS 26.1
  Low power      off
  Time           en-AU · UTC+10:00
  Network        mainnet
  Connection     wifi
  Memory
    Used           210 MB
    Available      1.9 GB
  Notifications  fast mode, push token registered
  Permissions
    Camera         granted
    Microphone     not asked
  Storage
    Database       48 MB
    WAL            1.2 MB
    SHM            33 kB
    Attachments    310 MB (limit 1.0 GB)
    Free           41 GB
  Config sizes
    user_profile   small
    contacts       medium
  Logs
    Files          10
    From           2026-10-07 22:14:03Z
    To             2026-10-09 07:41:02Z
    Size           20 MB
    Left out       nothing
  Redactions (this run)
    hex            12
    base64         3
====================================================================================================
```

- **Rounded to two significant figures** for memory, free space, database and attachment sizes:
  support needs the size, not the byte. Rounding coarsens these figures; it does not anonymise them.
  A 48 MB database still reads `48 MB` in every export made that week, and with the locale and the
  other rows it can still link two exports from one device. Rounding happens before the unit is
  chosen, so 999,999 bytes reads `1.0 MB`, never `1000 kB`.
- **Config sizes are buckets of likely cost**: small (no cost worth seeing), medium (a regular
  account's), large (a likely cost), very large (almost certainly one), each config with lines of
  its own by what makes it cost. Every change regenerates, pushes, stores and merges a whole config,
  and past about 128 kB a push goes multipart; the conversation-state config changes on every read,
  so its lines are a quarter of contacts'; every group is a swarm to poll, so groups are bucketed by
  count (~10, ~50, ~200). `BUCKET_LINES` in `packages/logging/src/export.ts` has the measurements.
  A bucket rather than a number because an exact size is close to a count of somebody's contacts.
- **WAL and SHM** sit under the database because a WAL that keeps growing is a checkpoint that is not
  happening. The same three sizes are also logged as a line when the database opens and when the
  app goes to the background (desktop: on quit), with the journals exact.
- **Total memory** appears only on desktop; on a phone the model says it.
- A field the platform can't answer says `unknown`; one that doesn't apply (permissions on desktop)
  is left out. A platform that can't describe itself at all costs the header its rows, never the
  export: every row reads `unknown` and the files still go. The compressed size isn't in the
  header, since the header is inside what is compressed.
- **Redaction counts** are those of the process that swept the lines: on a phone, the one process;
  on desktop, main, which sweeps the renderer's lines and libsession's as well as its own.
- **From and To** come from the first timed line of the oldest file and the last of the newest.
  Only the first and last 16 KiB of each are read.
- **Body:** the retained files chosen **newest-backwards** up to the budget and written **oldest
  first**, so the file reads in time order. Each launch opens with its own startup block; a file that
  continues a launch after rotation is preceded by `── continued in session-…-1.log`.
- **File name, no spaces:** `session-logs-<platform>-<version>-<UTC basic>.log.gz`. `isExportName`
  recognises one, so the phones can sweep earlier exports out of the cache before writing the next.
- Delivered by the platform: desktop's main process asks where to save, the phones share it through
  the share sheet.
- **Desktop never writes to the chosen path until the export is whole.** It writes to
  `<chosen>.sessiondl` beside it (`.sessiondl1`, `.sessiondl2`… when that name is taken, as
  libsession does for downloads), opened so that no existing file is ever written over, then
  renames it onto the chosen path. A failed export removes the partial and leaves whatever was at
  the chosen path as it was. The path never reaches the renderer, not even in an error.
- First caller: Export Logs on the startup-failure screen.

### Where the header's facts come from

- **Install:** iOS reads it in `modules/session-logs`: simulator, TestFlight (sandbox receipt),
  development or ad hoc (embedded provisioning profile), otherwise App Store, by the same checks as
  the build variant. Android names the
  installing package: `Play Store`, `F-Droid` for any `org.fdroid.*`, `sideload or adb` where there
  is no installer, otherwise the package name. The Variant row is the authoritative signal for our
  own F-Droid build. Desktop says `unknown`.
- **Variant:** the build variant, one of `BUILD_VARIANTS` in `packages/app/src/buildVariant.ts`:
  the Android flavour, how iOS says the app was installed, or `desktop`, unless
  `EXPO_PUBLIC_SESSION_BUILD_VARIANT` overrides it. See `docs/BUILD_VARIANTS.md`.
- **Device, OS, memory, low power, permissions:** the phones read them natively in
  `modules/session-logs`. Android cannot tell "never asked" from "denied" without an activity, so a
  permission reads `granted` or `not granted`, and `not declared` where the manifest does not
  request it, which the system always refuses. Desktop's main process uses Electron and node's `os`; on Linux it adds the
  distro, display server, desktop and packaging.
- **Free space, database, attachments:** measured off disk by each platform, in the network's own
  data directory.
- **Config sizes:** libsession's `Client::config_sizes()`, through the bridge. The header says
  `unknown (could not be read)` where the call fails - a start that never opened the database - and
  `none (no account yet)` before there is an account, which has no configs to measure.

## Compression

Benchmark (2026-10, Apple silicon), 20.0 MiB of synthetic lines in this format (random pseudonyms
and numbers, which compress _worse_ than real logs):

|                                                              | time         | output   | ratio |
| ------------------------------------------------------------ | ------------ | -------- | ----- |
| node zlib (native), level 6                                  | **198 ms**   | 4.46 MiB | 4.5:1 |
| node zlib (native), level 9                                  | 387 ms       | 4.31 MiB | 4.6:1 |
| fflate 0.8.2, level 6, V8 JIT                                | 321 ms       | 4.88 MiB | 4.1:1 |
| fflate 0.8.2, level 6, **V8 `--jitless`**                    | **6,040 ms** | 4.88 MiB | 4.1:1 |
| **fflate 0.8.2, level 6, Hermes** (iOS simulator, dev build) | **7,482 ms** | 3.30 MiB | 6.1:1 |

Hermes has no JIT, and the measured figure agrees with the jitless stand-in: **7.5 s on the iOS
simulator** (a dev build, which compiles lazily; a release build's precompiled bytecode is faster, but
not by the factor of thirty that separates it from native), with the JS thread frozen for all of it.
The simulator's input was more repetitive, hence its better ratio.
The whole 20 MiB budget still fits in about 5 MiB compressed, but only just.

So compression belongs to the platform, through the `logs` port's `deliver`, not to
`packages/logging`. Desktop's main process streams the parts through `zlib`. The phones use
`apps/mobile/modules/session-logs`: the system zlib on iOS and `GZIPOutputStream` on Android, file to
file, off the JS thread. Both run it on a background queue rather than the one Expo modules share,
which would otherwise wait behind the whole deflate. Seven and a half seconds of a frozen JS thread behind a share sheet is not
acceptable, and fflate cannot move off that thread on Hermes, which has no workers.
