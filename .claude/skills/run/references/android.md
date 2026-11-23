# Android

`$ANDROID_HOME` is set on this machine and holds the SDK, the emulator and several NDKs.
Everything below assumes `A=$ANDROID_HOME/platform-tools/adb`.

The package is **`org.getsession.session2`**, from `apps/mobile/app.json`. A QA emulator usually
has other Session builds on it; name this one exactly.

## Emulators

```sh
$ANDROID_HOME/emulator/emulator -list-avds
```

`Session_QA_1` through `4` are the QA pool. Booting one, detached, with the noise off:

```sh
nohup $ANDROID_HOME/emulator/emulator -avd Session_QA_1 \
  -no-snapshot-load -no-audio -no-boot-anim > "$SCRATCH/emulator.log" 2>&1 &
```

Waiting for it - a bounded wait, because a boot that fails otherwise never returns:

```sh
for i in $(seq 60); do
  [ "$(timeout 10 $A shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 5
done
timeout 15 $A devices
```

Sixty five-second attempts is five minutes, which is generous for a warm AVD and short enough
to notice. If it expires, read `$SCRATCH/emulator.log` rather than trying again.

## Building the native side

```sh
pnpm --filter @session/bridge-rn build:libsession:android    # one ABI by default, or `all`
```

Slow the first time on a machine - it cross-compiles libsession and every dependency for the
ABI - and cached per machine after that: seconds on a libsession already built, libsession alone
when only it changed (`packages/bridge-core/README.md`). `packages/bridge-rn/README.md` has the rest of the chain.

## Install and launch

```sh
timeout 300 $A install -r apps/mobile/android/app/build/outputs/apk/play/debug/app-play-debug.apk
timeout 20 $A reverse tcp:8081 tcp:8081     # so the dev client can reach Metro
timeout 30 $A shell monkey -p org.getsession.session2 -c android.intent.category.LAUNCHER 1
```

`monkey` rather than `am start` because it needs no activity name, which changes with the
router.

## Logs

```sh
timeout 15 $A logcat -c                                     # before acting
timeout 15 $A logcat -d | grep -E "ReactNativeJS|SessionBridgeRN|FATAL EXCEPTION"
```

`-d` dumps and exits. `adb logcat` without it never returns, which is the wrong shape for a
question you want answered.

Worth knowing what is signal: `ReactNativeJS` is the app's own console, `SessionBridgeRNOnLoad`
is the native library loading, `ExpoModulesCore` is the JSI interop coming up. Everything from
`Finsky`, `AppsFilter`, `OpenGLRenderer` and `AppSearchIcing` is the emulator talking to itself.

## Screenshots

```sh
timeout 20 $A exec-out screencap -p > "$SCRATCH/screen.png"
```

`exec-out` rather than `shell` - `shell` mangles the binary on the way through.

## The app's own storage

The only way to see what libsession actually wrote:

```sh
timeout 15 $A shell run-as org.getsession.session2 ls -la files/session
timeout 30 $A exec-out run-as org.getsession.session2 cat files/session/session.db > "$SCRATCH/session.db"
```

`run-as` works on a debug build and needs no root.

## Resetting state

libsession's database persists across launches, so a test that assumes a fresh account has to say
so:

```sh
timeout 30 $A shell pm clear org.getsession.session2      # keeps the APK, drops the data
timeout 60 $A uninstall org.getsession.session2           # drops the APK as well
```

Either gives the next launch a fresh database and a fresh key: `pm clear` empties
`/data/data/<package>`, which is where both the database and `expo-secure-store`'s backing
preferences live. `pm clear` is the quicker one and the right default; reach for `uninstall`
when the question is specifically about a first install.
