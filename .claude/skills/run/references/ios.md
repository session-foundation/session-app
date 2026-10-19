# iOS

Builds and runs, on a simulator, against real libsession. Done on a remote Mac - Xcode 26.2,
macOS 15.7 - because the machine most of this repository was built on is Linux, where none of it
is possible.

Device builds and a release-shaped xcframework are untried. Everything below has been run.

## Building

```sh
pnpm --filter @session/bridge-rn build:libsession:ios     # libsession + the shim
cd apps/mobile && npx expo prebuild --platform ios
cd ios && pod install
xcodebuild -workspace Session.xcworkspace -scheme Session -configuration Debug \
  -destination "platform=iOS Simulator,name=iPhone 17 Pro" \
  -derivedDataPath build/dd \
  CODE_SIGN_IDENTITY="-" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES
```

The signing flags are not decoration - see [traps.md](traps.md). `CODE_SIGNING_ALLOWED=NO` is the
obvious thing to pass for a simulator and it breaks the keychain.

The first `build:libsession:ios` on a given libsession takes a long time: it cross-compiles
libsession and every dependency. Every later clone on the same libsession takes it from the
machine-wide cache in seconds - see `packages/bridge-rn/ios/README.md`, including
`SESSION_LIBSESSION_IOS_KEEP_BUILD=1` for incremental rebuilds while changing libsession.

### Building without taking over the machine

Lower the priority rather than the core count, so the build still uses every core nobody else
wants:

```sh
taskpolicy -d throttle nice -n 19 pnpm --filter @session/bridge-rn build:libsession:ios
taskpolicy -d throttle nice -n 19 xcodebuild …
```

`nice` lowers CPU priority and `-d throttle` lowers disk priority; children inherit both.

**Never `taskpolicy -b`.** It confines the build to the efficiency cores, 4 of 14 on an M4 Pro:
a libsession `all` build took 69 minutes under it, where `both` takes about 4 under `nice`.

To cap the cores outright, `JOBS=6` limits libsession's build, `CMAKE_BUILD_PARALLEL_LEVEL=6` the
shim's, and `-jobs 6` xcodebuild's.

### Not doing work twice

- **Build one architecture.** Name a simulator in `-destination`, as above. A generic
  destination, `generic/platform=iOS Simulator`, builds arm64 and x86_64, every file twice, and
  nothing on an Apple silicon Mac runs the x86_64 half; if one is unavoidable, add
  `ARCHS=arm64 ONLY_ACTIVE_ARCH=YES`.
  The same goes for libsession: the default `both` mode, never `all`, unless an Intel Mac is the
  target.
- **Prebuild and `pod install` only when the native side changed**: a new native module, a config
  plugin, `app.json`/`app.config.ts`. Both regenerate the Xcode project, and xcodebuild then
  recompiles every pod - well over a thousand files - however little moved.
- **Shut the simulators down when finished**, `xcrun simctl shutdown all`. Each booted one holds
  gigabytes, and the Mac is shared: once it swaps, every build on it slows down.

## Simulators

```sh
xcrun simctl list devices available
xcrun simctl boot "iPhone 17 Pro"
```

**Do not wait with `simctl bootstatus -b`.** It is documented as exiting when the device is ready
and it does not reliably do so - it hung here on an already-booted device and left processes
behind. Wait on something that proves the device is serving requests:

```sh
for i in $(seq 30); do
  xcrun simctl spawn "$UDID" /usr/bin/true >/dev/null 2>&1 && break
  sleep 4
done
```

That check matters for its own sake: a device can report `Booted` and not be working. The tell is
`simctl spawn` failing with `NSPOSIXErrorDomain code=2` and `get_app_container` printing nothing.
`simctl shutdown` then `boot` clears it.

Address the device by UDID rather than by name once you have it - names are ambiguous across
runtimes.

## Install, launch, look

```sh
D=build/dd/Build/Products/Debug-iphonesimulator
xcrun simctl install "$UDID" "$D/Session.app"
xcrun simctl launch "$UDID" org.getsession.session2      # prints the pid
xcrun simctl io "$UDID" screenshot ~/shot.png
```

A screenshot is the fastest way to read a JavaScript error: React Native's LogBox renders it in
full, and the log will only tell you `RCTLogBoxView` became the key window.

## Driving the UI

`simctl` has no tap. Use [idb](https://fbidb.io), which reads the app's own view hierarchy, so
every `testID` is a handle and no coordinate has to be derived from the window:

```sh
brew trust facebook/fb && brew install facebook/fb/idb    # the tap needs trusting first
```

**`--api axbridge` is the whole trick.** idb's default accessibility backend reports only what
VoiceOver would see - the text leaves - and every one of them has a null `AXUniqueId`. `axbridge`
walks the real hierarchy instead, where the `RCTViewComponentView` behind each pressable carries
the `testID` as its `AXUniqueId`:

```sh
$ idb ui describe-all --udid "$UDID" --api axbridge | jq -c '.[] | select(.AXUniqueId) | {AXUniqueId, frame}'
{"AXUniqueId":"conversation-list","frame":{"x":0,"y":59,"width":402,"height":815}}
{"AXUniqueId":"conversation-list-settings","frame":{"x":343,"y":72,"width":44,"height":44}}
```

`tap`, `set-value` and `text` do not take `--api axbridge`, so a marker cannot be matched against
a `testID`. Resolve the frame yourself and act on its centre - which is still element-addressed,
because the frame comes from the app rather than from the window:

```sh
centre() {
  idb ui describe-all --udid "$UDID" --api axbridge | python3 -c '
import json, sys
[e] = [e for e in json.load(sys.stdin) if e.get("AXUniqueId") == sys.argv[1]]
f = e["frame"]; print(int(f["x"] + f["width"] / 2), int(f["y"] + f["height"] / 2))' "$1"
}

read X Y < <(centre conversation-list-settings)
idb ui tap --udid "$UDID" "$X" "$Y"                             # navigate
idb ui set-value --udid "$UDID" "$X" "$Y" --value "$ACCOUNT_ID" # fill a field outright
idb ui text --udid "$UDID" "$ACCOUNT_ID"                        # or type into the focused one
```

Verified end to end on the mac mini: tapping `conversation-list-settings` lands on the settings
screen, and both `set-value` and `text` put an account ID in the new-conversation field. **The
hardware keyboard does not have to be connected for any of it** - `ConnectHardwareKeyboard` is
`false` on that device and `idb ui text` types anyway, because idb delivers to the target rather
than to Simulator.

`simctl openurl "$UDID" session:///new` still reaches any route in one step and is worth
preferring to a sequence of taps. iOS asks "Open in Session?" first, and that dialog has to be
tapped.

<details>
<summary>Without idb: coordinates, AppleScript, and the hardware keyboard</summary>

Needs assistive access granted by a person at the machine - System Settings › Privacy & Security
› Accessibility, for `osascript`, and it covers an ssh session too.

**The window is scaled.** Simulator fits the device into whatever size the window is - 402x874
points into 391x849 - so nothing derived from the window frame lands where it should. The device
view's own accessibility frame is the mapping:

```sh
osascript -e 'tell application "System Events" to tell process "Simulator" \
  to tell window 1 to get {position, size} of group 1'       # 309, 107, 391, 849
```

Screen x is that x plus point x times 391/402, and the same for y. Twenty points out hits the
label above a field, which looks exactly like a click that did not register.

**Typing needs the hardware keyboard, which is off by default.** Keystrokes otherwise reach
Simulator rather than the device, and some are its own shortcuts - a `keystroke` of an account ID
opened the React Native dev menu. The I/O menu item does not stick because the setting is per
device and read at boot:

```sh
xcrun simctl shutdown all && killall Simulator
/usr/libexec/PlistBuddy \
  -c "set :DevicePreferences:$UDID:ConnectHardwareKeyboard true" \
  ~/Library/Preferences/com.apple.iphonesimulator.plist   # `add ... bool true` if absent
xcrun simctl boot "$UDID" && open -a Simulator
```

The bare `defaults write com.apple.iphonesimulator ConnectHardwareKeyboard` form stopped working
around Xcode 11; it is `DevicePreferences` keyed by UDID now, which is why every older recipe for
it appears to do nothing.

Or go through the pasteboard, which needs no restart:

```sh
printf '%s' "$TEXT" | xcrun simctl pbcopy "$UDID"
```

Then click the field, click it a second time, and the `Paste | AutoFill` callout appears just
above it; click `Paste`. Simulator's own Edit › Paste stays disabled and is not the way in.

</details>

## Logs

```sh
xcrun simctl spawn "$UDID" log show --last 5m --style compact --predicate 'process == "Session"'
```

The predicate is essential. Without it the output is thousands of lines from `storekitd`,
`videosubscriptionsd` and friends, none of it yours.

## The app's own storage

```sh
G=$(xcrun simctl get_app_container "$UDID" org.getsession.session2 groups | cut -f2)
ls -la "$G/session/"*/
```

The data lives in the app-group container, not Documents (see `docs/STORAGE.md`): `groups` prints
`group.<bundle id>` and its path, one per line. `session.db` with its `-shm` and `-wal`, in the
network's directory, is the proof that the bridge carried a command down and an answer back. A
network directory holding only `attachments` means the transport was built and `init` never
completed - read the LogBox. The logs are in `$G/logs/`.

## Resetting state

```sh
xcrun simctl uninstall "$UDID" org.getsession.session2
xcrun simctl erase "$UDID"                               # the whole device
```

## Driving a simulator without hanging

**Reach for these in this order.** Appium is last, not first -- its session-create is what hangs,
and a hang costs twenty minutes rather than failing.

1. **Screenshots**: `xcrun simctl io <udid> screenshot out.png`. Seconds, no driver, never hangs.
2. **Taps, typing, the accessibility tree**: the desktop app's iOS Simulator tool
   (`mcp__Claude_Code_iOS_Simulator__control`) -- `tap`, `text`, `inspect`, `screenshot`. Instant,
   no server. The first use of a device asks the user once; a refusal errors immediately rather
   than blocking.
3. **Appium** only for what neither can do, and then **in the background with a timeout of 180s or
   less**. Never in the foreground, and never with a multi-minute timeout -- a stuck
   `createSession` looks exactly like a slow one.

The rule behind it: a foreground command that can block gets a short `timeout` so it fails fast and
says so. Long waits belong in the background, where they can be checked on.

### Typing drops characters, silently

`text` injection loses letters - reproducibly `g`, and most shifted keys. Typing
`Flag Check` into a field lands `flck`, and a thirteen-word recovery phrase arrives with a word
missing a letter. Nothing reports it: the app sees exactly the characters it was given and refuses
the phrase, which reads as a bug in the field.

**So do not type anything whose exact contents matter.** Put it on the device's pasteboard and
paste it instead:

```sh
printf '%s' "$PHRASE" | xcrun simctl pbcopy "$UDID"
```

then long-press the field (`tap` with `duration: 1.2`) and press **Paste**. Where typing is
unavoidable, reveal the field and read back what actually landed before drawing any conclusion
from what the app did with it.

### CocoaPods dies while printing its own error

`pod install` — and so `expo prebuild` and `expo run:ios` — can fail with a Ruby backtrace ending
in `UnicodeNormalize.normalize: Unicode Normalization not appropriate for ASCII-8BIT`. That is
CocoaPods crashing inside its _error reporter_, so whatever actually went wrong is never printed,
and the trace points at `error_report.rb` rather than at the problem.

It is the locale. Run it with a UTF-8 one and it both reports properly and, in the case seen here,
simply succeeds:

```sh
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo prebuild -p ios
```

Worth setting on any `pod`, `expo prebuild` or `expo run:ios` invocation rather than reaching for
it after a failure.

### A new native module needs a prebuild, not just an install

Adding an `expo-*` package with a config plugin (a camera, say) changes the generated `Info.plist`
and the Podfile. `pnpm install` does neither, and `pod install` alone applies no plugins — the
permission string simply never reaches the bundle, and the failure arrives much later as the OS
killing the app when it touches the API. `npx expo prebuild -p ios` is the step that applies them;
`apps/mobile/ios` is generated and gitignored, so there is nothing to review afterwards.

### `plutil -extract` overwrites the file it reads

Reading one key out of a built `Info.plist` with

```sh
plutil -extract CFBundleLocalizations json Session.app/Info.plist
```

prints the value **and replaces the plist with it**. The next read then fails with
`Unexpected character [ at line 1`, and the app no longer installs: `Missing bundle ID`. The
damage is to the build product rather than to any source, so the fix is to delete the `.app` and
build again — but the bundle looks fine in Finder, and the install error names nothing that
suggests a clobbered plist.

Always send the output somewhere explicitly:

```sh
plutil -extract CFBundleLocalizations json -o - Session.app/Info.plist
```

### Whose language the permission prompts are in

The camera and notification prompts are drawn by the system, not by the app, and the system
chooses the `.lproj` by the **device's** preferred languages. Launching the app with
`-AppleLanguages "(ja)"` localizes everything the app draws and leaves the prompt in English,
which reads as the localized strings not being in the bundle at all.

To see the real thing, set the language on the simulator and reboot it:

```sh
xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array ja
xcrun simctl spawn "$UDID" defaults write -g AppleLocale -string ja_JP
xcrun simctl shutdown "$UDID" && xcrun simctl boot "$UDID"
```

`xcrun simctl privacy "$UDID" reset camera <bundle id>` puts the prompt back so it can be asked
for again.
