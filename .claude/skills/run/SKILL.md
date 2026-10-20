---
name: run
description: Launch the desktop or mobile app, drive a device or emulator, read its logs and screenshots, or run the e2e suite. Use when asked to run, start, see, screenshot or diagnose session-app on any platform.
---

# Running session-app, and watching it run

Two jobs: starting the thing, and finding out what it did. The second is where the time goes,
and the rules below are why.

Both apps run against real libsession by default. `EXPO_PUBLIC_SESSION_FAKE=1` picks the fake instead - no
network, a seeded history, and nothing to wait for - which is the loop to reach for unless the
question is specifically about the real bridge.

## Five rules for driving a device

Every one of these was learned by losing time to it.

**Bound every wait, and put a `timeout` on every command.** `adb` against a wedged emulator
blocks for ever, and so does a poll loop with no ceiling - which looks identical to a hung
session from outside. Prefer one deadline check to a loop; when a loop is unavoidable, cap the
iterations and print progress so silence is never the only output.

**Grep for the failure as well as the success.** A filter that matches only the success marker
is silent through a crash, and silence is indistinguishable from "still starting". Before
watching for anything, ask what this would print if the process died right now.

**Name the app exactly, from one source of truth.** `pm list packages | grep session` returns
other people's Session builds - there are usually two or three on a QA emulator - and reading the
wrong app's logcat is a confusing way to spend ten minutes. The ids are in
[references/traps.md](references/traps.md); they come from `app.json` and the desktop manifest,
not from a guess.

**Clear the log, act, then read.** `adb logcat -c` before launching, or you will read a warning
you fixed twenty minutes ago and go looking for it again.

**Artifacts go to the scratchpad**, never into the repository. Screenshots, logs and pulled
databases are all disposable.

## Proving the bridge is alive

The one check worth knowing, because it distinguishes "the app started" from "the whole stack
works" in about fifteen seconds. It asks three questions in order, and the order matters: each
one is meaningless if the one before it failed.

1. **Did the native library load?** Nothing above it can work if not.
2. **Did libsession open its database?** This is the real proof - the file only exists if the
   frame stream carried a command down and an answer back.
3. **Did anything reject?** A promise that failed silently leaves a blank screen and no clue.

### Android

```sh
A=$ANDROID_HOME/platform-tools/adb
PKG=org.getsession.session2

timeout 15 $A logcat -c
timeout 30 $A shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null
sleep 20   # a fixed, bounded wait beats a poll loop for something that takes this long

# 1. the library
timeout 15 $A logcat -d | grep "SessionBridgeRNOnLoad"
# 2. the database - the answer that matters
timeout 15 $A shell run-as $PKG ls -la files/session
# 3. anything that broke
timeout 15 $A logcat -d | grep -E "ReactNativeJS.*([Ee]rror|Uncaught)|FATAL EXCEPTION"
```

A healthy result is `Successfully loaded SessionBridgeRN C++ library!`, then `session.db`
alongside `session.db-shm` and `session.db-wal`, then nothing from the third command. The WAL
files are the tell that libsession really opened it rather than something creating an empty file.

`files/session` holding only `attachments` means the transport was built and `init` never
completed - look at step 3.

### Desktop

The equivalent is simpler because the bridge is in the main process and its stdout is right
there:

```sh
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE pnpm exec electron out/main/index.js
```

The database lands under the platform's userData directory - see
[references/desktop.md](references/desktop.md). No `session.db` and no error on stdout means the
renderer never asked, which is the port handshake in
[references/traps.md](references/traps.md).

## Platform mechanics

One file each, because the verbs are the same and only the tooling differs:

- [references/android.md](references/android.md) - emulators, install, logcat, screenshots, app
  storage, resetting state
- [references/desktop.md](references/desktop.md) - Electron launch, parallel windows, where the
  data lives
- [references/ios.md](references/ios.md) - `simctl`, and why none of it runs on this machine

## The loops

```sh
pnpm dev:desktop            # libsession, hot reload - the primary UI loop
pnpm dev:mobile             # libsession, needs a dev client
pnpm dev                    # both at once
pnpm android                # build and install the dev client itself, then start Metro
```

The desktop app needs the addon built before any of those will start; see
`packages/bridge-node/README.md`. On the fake it does not.

`pnpm android` prebuilds only when `apps/mobile/android/` is absent, and the config plugins -
the media loader's among them - are applied at prebuild. A checkout whose `android/` predates
one builds an app that, in debug, refuses to start and names the fix:
`pnpm --filter @session/mobile prebuild --platform android --clean`, then `pnpm android`.

Against the fake:

```sh
pnpm fake-media:fetch                          # once: the thirty photographs the fake draws
pnpm --filter @session/mobile fake-media:push  # once per device or after `pm clear`
pnpm dev:fake               # both; or dev:desktop:fake / dev:mobile:fake
```

The fake refuses to start without its photographs and names the command that fixes it. Which
world it opens is `EXPO_PUBLIC_SESSION_FAKE_FIXTURE` - `friends`, `showcase`, `backlog`,
`newcomer`, `crowd`, `rows` - with `EXPO_PUBLIC_SESSION_FAKE_CROWD_PEERS` and
`EXPO_PUBLIC_SESSION_FAKE_CROWD_HISTORY` sizing `crowd`, and `EXPO_PUBLIC_SESSION_FAKE_SLOWDOWN=10`
makes every transfer ten times slower, on both apps.

Every variable an app reads carries `EXPO_PUBLIC_`, desktop's included: Metro inlines one into the
bundle only when its name does, and it caches the transform - so a Metro started without it keeps
serving a bundle that ignores it until `expo start --clear`. `SESSION_FAKE_MEDIA_DIR` is the one
without it: a path on the host, read by the fetch script, desktop main and the push script, never
by a bundle. turbo hands a task only what `turbo.json` lets through: `dev` and `dev:fake` forward
`EXPO_PUBLIC_SESSION_*` and `SESSION_*`, so a variable named otherwise needs adding there.

## Against a local devnet

`.env` at the repo root, which both apps load; `.env.sample` says what goes in it. The whole of a
devnet run is two lines, and `docs/ARCHITECTURE.md` has the reasoning:

```sh
EXPO_PUBLIC_SESSION_NETID=devnet
EXPO_PUBLIC_SESSION_DEVNET_SEED_URL=192.168.1.114:1280      # the seed node's oxend RPC, not a storage port
```

Check the devnet is reachable before blaming the app - oxend binds that RPC to the devnet host's
own address while the storage servers bind everything, so a machine that can reach the swarm can
still fail here:

```sh
curl -s -m 5 -X POST http://192.168.1.114:1280/json_rpc -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}' | head -c 200
```

One command says whether the bridge can attach to it at all, without an app in the way:

```sh
EXPO_PUBLIC_SESSION_DEVNET_SEED_URL=192.168.1.114:1280 \
  pnpm --filter @session/bridge-node exec vitest run tests/devnet --reporter=verbose
```

A devnet build keeps its own database - `userData/devnet/` - so it onboards from scratch the
first time and leaves a mainnet account where it was. Mobile needs the same names - they already carry
`EXPO_PUBLIC_` for Metro's sake, and desktop reads that spelling too - and a dev client built
since the shim last changed.

## The e2e suite

```sh
pnpm --filter @session/desktop build
cd tests/e2e && env -u ELECTRON_RUN_AS_NODE xvfb-run -a pnpm exec playwright test --project desktop
```

Drop `xvfb-run` where there is a display; add `--headed` to watch it.

## Everything CI runs

```sh
pnpm format:check && pnpm lint && pnpm lint:manifests && pnpm boundaries \
  && pnpm typecheck && pnpm test && pnpm knip && pnpm codegen:check && pnpm dedupe --check
```

## Known traps

[references/traps.md](references/traps.md), one table per platform. Read it when something
behaves impossibly - most of the entries present as a different problem than they are.
