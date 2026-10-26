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

libsession's outputs are cached per machine in `~/Library/Caches/session-app/libsession-ios`,
keyed by the source hash below, the slices built, `IPHONEOS_DEPLOYMENT_TARGET` and the Xcode build.
The five most recently used are kept. A clone on a cached libsession skips its build, the build
tree is deleted afterwards, and the xcframework here is an APFS clone of the cached one.
`SESSION_LIBSESSION_IOS_CACHE` replaces `~/Library/Caches/session-app`; keep it on the same volume
as the clones. `SESSION_LIBSESSION_IOS_KEEP_BUILD=1` bypasses the cache and keeps the build tree,
for incremental rebuilds while changing libsession.

The shim is an xcframework rather than a directory of archives because `vendored_libraries` has
no per-SDK form: a directory of `.a` files is a directory for exactly one slice, and the two have
to coexist.

`BUILT.json` beside them records which slices are present, which libsession commit they came
from, and a hash of the whole source tree. Neither xcframework carries any of that, and a rebuild
of one slice against a submodule that has since moved looks exactly like a complete build -- so
this is the file to read when something links and then behaves like an older libsession.

**The hash matters more than the commit.** The nested submodules routinely carry uncommitted
patches, and a commit says nothing about them; the hash is over every tracked path's working-tree
contents, so an uncommitted edit changes it. It is the legacy client's own check, from
`Scripts/build_libSession_util.sh`.
