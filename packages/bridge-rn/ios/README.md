# iOS

Two xcframeworks go here, both built by
`pnpm --filter @session/bridge-rn build:libsession:ios` and neither committed: they are hundreds
of megabytes of per-architecture static libraries, and they are reproducible from the submodule
pin.

- `libsession-util.xcframework` — libsession itself, from its own `utils/ios.sh`.
- `SessionBridgeCore.xcframework` — the shim alone, one library per slice: libsession's bundle
  carries every library it links.

**Both carry a device slice as well as a simulator one**, which is the default. The device
slice is not only for a phone: an iOS app running on an Apple silicon Mac — "Designed for iPad" —
runs the device slice too, so a simulator-only build cannot be run there at all.

The simulator slice is this machine's architecture and no other. `all` adds the x86_64 one, for an
Intel Mac running the simulator; it is another 1.6GB of build tree and nothing on an Apple silicon
machine will ever load it, so it is a release's business rather than the default.

Each slice of libsession is built through the per-machine cache `packages/bridge-core/README.md`
describes, keyed also by `IPHONEOS_DEPLOYMENT_TARGET`, the Xcode build and the ios-cmake toolchain.
A clone on a cached libsession skips the build, and a libsession change reuses every dependency.
libsession's own `utils/ios.sh` then merges the slices and makes the xcframework.

The shim is an xcframework rather than a directory of archives because `vendored_libraries` has
no per-SDK form: a directory of `.a` files is a directory for exactly one slice, and the two have
to coexist.

`BUILT.json` beside them records which slices are present, which libsession commit they came
from, and a hash of the whole source tree. Neither xcframework carries any of that, and a rebuild
of one slice against a submodule that has since moved looks exactly like a complete build -- so
this is the file to read when something links and then behaves like an older libsession.

**The hash matters more than the commit.** The nested submodules routinely carry uncommitted
patches, and a commit says nothing about them; the hash is over the working-tree contents of
every tracked path and every untracked one not ignored, so an uncommitted edit or a new file
changes it. It is the same hash the per-machine libsession cache keys its builds on.
