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
  file in every submodule and every untracked one not ignored, uncommitted edits included, paths
  and contents), the target and the cmake arguments. A clone on a cached libsession builds nothing; its copy is hard
  links into the entry on Linux and an APFS clone on macOS.
- `trees/`: one build tree per set of build rules (libsession's top `CMakeLists.txt` and `cmake/`,
  session-deps included), target and cmake arguments, shared by every clone. When libsession's
  sources change and those do not, the dependencies are not configured or built again; only
  libsession compiles, through ccache. A change to any of them starts a new tree, because a
  dependency rebuilt under a finished one is how meson-based builds break.

A tree builds from its own copy of libsession, synced from the clone by content before each
build: only files whose content changed are copied, and only those look new to make, whichever
clone the tree last built. An entry is keyed by the hash of that copy, so editing libsession
during a build changes neither the build nor its entry; the next build picks the edit up.

The target is the ABI, platform level and NDK revision on Android, the OS, architecture,
compilers and macOS deployment target on desktop, and the slice, deployment target, Xcode build
and ios-cmake toolchain on iOS. `CFLAGS`, `CXXFLAGS`, `CPPFLAGS` and `LDFLAGS` are cleared for the
build: CMake would keep a tree's first ones for good. One build at a time runs in a tree; a second
waits for it. On a self-hosted runner, point `SESSION_LIBSESSION_CACHE` at a directory outside the
job's workspace.

`entries/` keeps its ten most recently used and `trees/` its five, whatever the target, plus any
tree used in the last fourteen days: an entry is a fraction of a tree's size and a warm tree
rebuilds it, while a tree is a cold build, and there is one per target and set of build rules.

`SESSION_LIBSESSION_CACHE_MAX_GB` caps the whole cache on top of that, removing the least recently
used entries and then trees, but nothing used in the last day: one run builds each iOS slice or
Android ABI in a tree of its own, and removing an earlier one's would make every run cold. Set it
above what one run's trees take, `du -sh` of `trees/` after a build; a cache that cannot fit says
so. What a clone already took from an entry is a hard link or APFS clone, so removing it breaks
nothing.

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
