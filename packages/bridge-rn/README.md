# `@session/bridge-rn`

The Nitro module: `session-bridge-core` behind a JSI HybridObject, loaded in the mobile app. Like
the addon, it holds no logic - what it owns is the hop from Core's loop onto the JavaScript
thread. Nitro's void callbacks are bound to the runtime's dispatcher, so calling the sink from
Core's loop arrives on the JS thread in order, which is the same guarantee the addon gets from a
thread-safe function.

It is linked in exactly one place: `packages/client/src/nativeTransport.native.ts`. Everything
above a `BridgeTransport` is meant to be unable to tell which one it has.

## Building

```
pnpm --filter @session/bridge-rn build:libsession:android   # once per ABI, slow
cd apps/mobile && npx expo prebuild --platform android
cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=x86_64 --no-configuration-cache
```

libsession is cross-compiled separately rather than from inside the Gradle CMake project, by
`scripts/build-libsession-android.sh`.

`--no-configuration-cache` is Gradle 9 against Expo, which still calls `node` at configuration
time. Nothing to do with this module.

## Four things that are easy to get wrong

Each of these builds and then fails at runtime, which is the expensive kind:

- **`JNI_OnLoad`.** Nitrogen generates the registration and the `initialize` that performs it, but
  not the entry point that calls it. Without `android/OnLoad.cpp` the library loads, says so, and
  `createHybridObject` fails with "not yet been registered".
- **The virtual base constructor.** `HybridObject` is a virtual base, so the most-derived class is
  what constructs it. A defaulted constructor compiles and fails at the first create.
- **A `ReactPackage`.** Autolinking looks for one to decide a package is linkable, and a pure-C++
  module has no reason to have one. Without `SessionBridgeRNPackage.kt` the module is skipped in
  silence and shows up much later as "SessionBridge does not exist".
- **Namespaces.** Nitro puts the implementation in `margelo::nitro::session::bridge::rn`, so an
  unqualified `session::bridge::ClientBridge` resolves inside that namespace and never reaches the
  shim, with an error that reads as if the header were missing.

## iOS

```
packages/bridge-rn/scripts/build-libsession-ios.sh all   # or both; slow
cd apps/mobile && npx expo prebuild --platform ios
cd ios && pod install
```

Then build and run from Xcode or `pnpm ios`; it runs on the iOS and iPadOS simulators.

Rebuild the xcframeworks whenever `bridge-core` or the libsession pin changes: their `Headers/`
sit ahead of the source on the search path, and neither `turbo build:native` nor `pod install`
refreshes them. Use `all` or `both`, not `simulator`, which renames the simulator slice and breaks
the next build. Run `pod install` again after a codegen that adds a header, since the nitrogen
output is copied into `Pods/`. See `ios/README.md` for what the two xcframeworks hold.
