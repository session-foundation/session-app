---
name: build-native
description: Rebuild the native layer after a change to packages/bridge-types, the shim C++ in bridge-core, a *.nitro.ts spec, or the libsession-util submodule. Use before running or testing any app on top of such a change.
---

# Rebuilding the native layer

| changed                      | run                                                                |
| ---------------------------- | ------------------------------------------------------------------ |
| `packages/bridge-types`      | `turbo codegen && turbo build:native`, then the iOS script below   |
| shim C++ (`bridge-core`)     | `turbo build:native`, then the iOS script below                    |
| `*.nitro.ts`                 | `turbo codegen`, `pod install`, then rebuild the mobile dev client |
| `libsession-util/` submodule | all three targets, then the contract suite against the real addon  |

The generated C++ under `packages/bridge-core/include/session_bridge/gen` is committed, and CI's
`codegen:check` fails if it is stale.

A submodule bump is committed only once the node addon, Android
(`pnpm --filter @session/bridge-rn build:libsession:android`) and iOS are rebuilt and
`pnpm --filter @session/bridge-node test` passes against the addon, not the fake.

## iOS does not follow `turbo build:native`

`turbo build:native` rebuilds only the node addon. iOS reads `bridge-core`'s headers from a vendored
binary, `packages/bridge-rn/ios/SessionBridgeCore.xcframework`, whose `Headers/` sit ahead of the
source on the search path, so iOS keeps compiling against whatever that artefact was built from.
`pod install` does not refresh it.

Rebuild it with `packages/bridge-rn/scripts/build-libsession-ios.sh`, whose default `both` mode
is the one to use; `all` only when an Intel Mac's simulator is the target, and never
`simulator`: the one-slice modes rename the simulator slice, and the next build fails with
`rsync … ios-arm64_x86_64-simulator: No such file or directory`.

A stale archive fails as nonsense from libsession rather than as a link error: the command enum
is renumbered, so an old archive dispatches a new command index to the wrong handler.

## Regeneration needs `pod install`

The nitrogen output is copied into `Pods/Headers/Public/SessionBridgeRN`, so a regeneration that
adds a header (a new type in the spec) leaves that copy without it until `pod install` runs.
