---
name: legacy-sender
description: Send real messages and attachments to session-app clients from the legacy Session Desktop, driven by session-playwright. Use to test receiving on real libsession (Android, iOS, desktop) - downloads, thumbnails, the viewer, export - when the fake is not enough.
---

# Sending from the legacy Session Desktop

The fake proves the UI; only a real sender proves the bridge. The legacy Session Desktop is the
sender: session-playwright already knows how to drive it, so a small driver reuses its helpers
to create an account and send text, pictures, files and video to any account ID.

Three checkouts, side by side:

| checkout             | what for                                          |
| -------------------- | ------------------------------------------------- |
| `session-desktop`    | the sender. Built, not run from source            |
| `session-playwright` | its helpers, and the Electron Playwright launches |
| `session-app`        | the clients receiving                             |

session-playwright's `.env` names the sender with `SESSION_DESKTOP_ROOT`. Leave
`LOCAL_DEVNET_SEED_URL` commented out to send on mainnet, which is where the session-app
clients are unless their own `.env` says devnet - sender and receivers must agree.

## Build the sender

```sh
cd session-desktop && pnpm build      # node 22's pnpm; there is none under node 24
```

A half-built checkout starts and then throws `Cannot find module '…/svgs/index'`: that is
`build:svg`, one of the steps a full build runs.

## The files it sends

The pictures are the fake's dev photographs, `~/.cache/session-app/dev-media/unsplash-01.jpg` to
`unsplash-10.jpg`. `pnpm fake-media:fetch` fills that folder; on a checkout without that script,
any ten JPEGs with those names will do. The PDF and the video are session-playwright's own
`sample_files`.

## The driver

[attach_sender.spec.ts.txt](attach_sender.spec.ts.txt) is the driver. Copy it in for a run and
delete it after - it is not a test, and session-playwright should not carry it:

```sh
cp .claude/skills/legacy-sender/attach_sender.spec.ts.txt \
   ../session-playwright/tests/automation/attach_sender.spec.ts
```

Run it from `session-playwright`, one action at a time:

```sh
env -u ELECTRON_RUN_AS_NODE NO_CLEAN=1 NO_TUI=1 USE_XVFB=0 PLAYWRIGHT_WORKERS_COUNT=1 \
  ATTACH_ACTION=create ATTACH_OUT=$SCRATCH/sender.json \
  npx playwright test tests/automation/attach_sender.spec.ts --reporter=line
```

| `ATTACH_ACTION` | does                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| `create`        | a new account; ID and recovery phrase go to `ATTACH_OUT` (mode 0600)      |
| `text`          | `ATTACH_TEXT` (or a hello) to each of `ATTACH_TARGETS`                    |
| `send`          | a hello, then one picture, three, seven, a PDF and a video to each target |

`ATTACH_TARGETS` is comma-separated account IDs. `ATTACH_INSTANCE` (default `attachsender`)
picks the data directory, `Session-production-devprod<instance>` under `~/.config` on Linux and
`~/Library/Application Support` on macOS, which persists between runs: create once, send many
times. Nothing else may have that instance open - stop a hand-started one first.

Why each setting is there:

- **`env -u ELECTRON_RUN_AS_NODE`** - terminals set it, and Electron then runs as plain Node:
  `powerMonitor` is undefined and the app dies on its first line.
- **`NO_CLEAN=1`** - `global.setup` otherwise deletes every `test-integration` data directory,
  which is other people's runs. The driver does not use that prefix, so its own account is safe
  either way.
- **`USE_XVFB=0`** - the window shows, so a person can watch it send.

The driver deliberately does not use session-playwright's `openApp`: that gives every run a
throwaway data directory, and a sender that forgets its account between runs is useless here.

## Order matters: let the client write first

A message from a stranger lands in Message Requests on every client. session-app's conversation
list does not show requests as rows, only as an unread badge that opens them, and the badge goes
once they are read. Have the receiving client send the sender a message first - writing to
someone approves them - then send from the legacy side.

## Traps in the driver, already handled

- **Staging is one file at a time.** Each picture is rescaled before it is staged, and pressing
  Send early sends what has arrived and stages the rest into the next message. A non-picture file
  is then refused because pictures are staged. `sendFiles` waits for every staged item.
- **Pictures and videos share a message; anything else goes alone.**
- **`waitForMessageStatus` gives a send 20 s**, which a first message on mainnet or an upload can
  outlast. The driver waits 180 s.
- **DevTools are closed.** The legacy app docks them over the window for any `devprod` instance,
  which every instance here is: it is part of the data directory's name. `launch` closes them
  from main, including when they open after the load.
- **The Donate appeal is dismissed.** An account over a week old gets a "New Hope for Session"
  dialog some time after launch, for its first few launches, covering the composer. Its close
  button has no test id; `launch` registers a locator handler that presses Escape whenever
  `cta-heading` shows, which Playwright runs before the next action.
- **The driver waits 15 s before closing.** A message stays in the legacy app's persisted send
  queue until its sync copy is stored, after the sent tick. Closing sooner makes the next launch
  store it again, under a new hash with the same sent timestamp, and libsession keeps both: legacy
  messages carry no message id, and it de-duplicates only by hash and message id. The run's last
  message then shows twice on whichever client received it. A clean run is one whose next launch
  sends nothing; the shutdown log's `0 jobs outstanding` counts SQL calls, not this queue.
- **Nothing evaluates in the page.** `window.evaluate` returns `null` for a string, even
  `'1 + 1'`, and fails with `result is not a function` for a function. Go through main instead:
  `app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('…'))`.
- **Wait for the onion path** (`checkPathLight`) after launch, or the first send times out.
- **`TEST_PRO_BACKEND` is forced off.** session-playwright's `.env` may set it for its Pro tests.
  With no dev Pro backend configured, the legacy app then throws on every poll that returns 1o1
  messages and never shows what the clients send, while configs still sync and it looks healthy.

## Driving the receiving clients

The clients need real libsession, not the fake - see the `run` skill.

**Android** - adb. The composer slides partly under the keyboard, so tapping its centre hits the
keyboard; tap the strip still visible above it, then the visible strip of Send. Read their bounds
from `uiautomator dump` _after_ the keyboard is up. `input text` takes `%s` for a space. A Back
press with no keyboard up leaves the app, and the next `input text` goes into the launcher's
search.

**Desktop** - over CDP, not Playwright's `_electron`. Playwright launches Electron with
`--password-store=basic --use-mock-keychain`, so `safeStorage` never reaches the real keychain,
cannot unseal the database key, and the app never opens a window. Start the built app
yourself and connect:

```sh
cd apps/desktop && env -u ELECTRON_RUN_AS_NODE -u EXPO_PUBLIC_SESSION_FAKE \
  ../../node_modules/electron/dist/electron out/main/index.js --remote-debugging-port=9333 &
```

then `chromium.connectOverCDP('http://127.0.0.1:9333')` from a script under `tests/e2e/`, and
drive it by test id. `EXPO_PUBLIC_SESSION_LOG=info` turns libsession's logging up.

**iOS** - idb on the Mac, as the `run` skill's `ios.md` describes. Use `idb ui set-value` for the
account ID and the message: typing drops characters, and the simulator's keyboard may be in
another language. The composer sits under the keyboard there too.

## What to check on each client

- every message arrives, with the right number of attachments in the right message
- a picture sent with no ThumbHash shows the placeholder, and the album's cloud
- a tap downloads the whole set; the picture then draws and the footer offers Export
- after the download, the tile and the file-row lead show libsession's thumbnail
- the viewer opens on a downloaded picture
- a PDF or a video is a file row with its name, and a video does not open in the viewer

Compare counts against the legacy side's own view of what it sent before calling anything a
receiving bug: a wrong batch looks identical on every client.
