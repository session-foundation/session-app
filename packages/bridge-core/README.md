# `session-bridge-core`

The C++ shim: one `session::client::Client` behind one ordered frame stream. The N-API addon and
the Nitro module are transports in front of it and hold no logic of their own.

The frames are the structs under `include/session_bridge/gen`, generated from
`@session/bridge-types` by `tooling/bridge-codegen` and committed; `pnpm codegen` refreshes them.
`packages/client/src/fake/fakeBridge.ts` is the same protocol written in TypeScript, and is what
this has to match. When the two disagree, the contract suite says which one is wrong.

## Building

```
cmake -G Ninja -S packages/bridge-core -B build/bridge-core \
    -DCMAKE_BUILD_TYPE=Release -DUSE_LTO=OFF \
    -DCMAKE_C_COMPILER=gcc -DCMAKE_CXX_COMPILER=g++
cmake --build build/bridge-core --parallel
```

**gcc, not clang, on a current Linux.** libsession's static dependencies include libtasn1, whose
gnulib vendoring only skips its own `bool` shim when the compiler is in C23 mode. gcc 15 defaults
to C23 and sails past; clang still defaults to C17, engages the shim, and fails to compile it
because the `HAVE_STDBOOL_H` that shim needs is never defined. Nothing about our own code prefers
either compiler.

## libsession's per-machine cache

The addon's `build:native`, `build:libsession:android` and `build:libsession:ios` (once per slice)
build libsession's static bundle through
`scripts/libsession-cache.sh`, which keeps two things per machine under
`$SESSION_LIBSESSION_CACHE` (default `~/.cache/session-app`, `~/Library/Caches/session-app` on
macOS):

- `entries/`: finished bundles, keyed by a hash of libsession's whole source tree (every tracked
  file in every submodule and every untracked one not ignored, uncommitted edits included), the
  target and the cmake arguments. A clone on a cached libsession builds nothing; its copy is hard
  links into the entry on Linux and an APFS clone on macOS.
- `trees/`: one build tree per set of build rules (libsession's top `CMakeLists.txt` and `cmake/`,
  session-deps included), target and cmake arguments, shared by every clone. When libsession's
  sources change and those do not, the dependencies are not configured or built again; only
  libsession compiles, through ccache. A change to any of them starts a new tree, because a
  dependency rebuilt under a finished one is how meson-based builds break.

The target is the ABI, platform level and NDK revision on Android, the OS, architecture,
compilers and macOS deployment target on desktop, and the slice, deployment target, Xcode build
and ios-cmake toolchain on iOS. `CFLAGS`, `CXXFLAGS`, `CPPFLAGS` and `LDFLAGS` are cleared for the
build: CMake would keep a tree's first ones for good. `entries/` and `trees/` each keep their five
most recently used, whatever the target, and anything used in the last fourteen days. One build
at a time runs in a tree; a second waits for it. On a self-hosted runner, point
`SESSION_LIBSESSION_CACHE` at a directory outside the job's workspace.

Dependency sources come from `https://builds.session.codes/deps`, libsession's own mirror, before
their own URLs, so gmp comes from there and not from gmplib.org, which drops downloads.
`SESSION_BRIDGE_DEPS_MIRROR` names another mirror.

## Layout

| file                                       | what                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `include/session_bridge/client_bridge.hpp` | the whole public surface: construct, `call`, `close` |
| `src/client_bridge.cpp`                    | callback wiring and command dispatch                 |
| `src/convert.cpp`                          | libsession's value types as the protocol's structs   |
| `include/session_bridge/media_url.hpp`     | the media scheme's parser and the servable check     |
| `include/session_bridge/gen/`              | the protocol in C++, generated; never edited by hand |
