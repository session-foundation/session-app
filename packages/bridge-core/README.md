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

## Layout

| file                                       | what                                                 |
| ------------------------------------------ | ---------------------------------------------------- |
| `include/session_bridge/client_bridge.hpp` | the whole public surface: construct, `call`, `close` |
| `src/client_bridge.cpp`                    | callback wiring and command dispatch                 |
| `src/convert.cpp`                          | libsession's value types as the protocol's structs   |
| `include/session_bridge/media_url.hpp`     | the media scheme's parser and the servable check     |
| `include/session_bridge/gen/`              | the protocol in C++, generated; never edited by hand |
