#!/bin/bash
set -euo pipefail

# Cross-compiles libsession for iOS and puts the xcframework where the podspec expects it.
#
# Wraps libsession's own utils/ios.sh rather than reimplementing it: its dependencies have to be
# built by libsession's build, which is the only one that gets the cross toolchain as far as the
# CMake-based ones.
#
# **Defaults to both kinds of slice**, which is what the legacy client gets: it consumes a prebuilt
# xcframework carrying device and simulator and therefore never chooses, and never ends up with an
# artefact that is missing the slice the build in front of it needs. Choosing was what left ours
# simulator-only, which is a confusing failure a long way from its cause -- CocoaPods refusing a
# vendored xcframework, or a "Designed for iPad" run finding no device slice to run.
#
# The default takes this machine's simulator architecture and no other. `all` adds the x86_64 one,
# which is a release's business: it is for an Intel Mac running the simulator, it is another 1.6GB
# of build tree, and nothing on an Apple silicon machine will ever load it.
#
# `simulator` is the debug loop's fast path, and `device` its opposite; both leave an artefact with
# one slice in it, so what they are for is a rebuild with SESSION_LIBSESSION_IOS_KEEP_BUILD=1, not a
# first build.
#
# **If you are here writing the release or archive scripts:** there are none yet, and an archive
# wants `device` rather than the default -- a simulator slice in a shipped binary is dead weight
# Apple will reject. `all` is for a release that still has to run on an Intel Mac's simulator.
# The modes exist; nothing selects them for a release because nothing does releases yet.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$here/../../.."
libsession="$repo/libsession-util"

if [ "$(uname -s)" != "Darwin" ]; then
    echo "iOS builds need macOS and Xcode." >&2
    exit 1
fi

case "${1:-both}" in
    both)      platform=""              ; archs="$(uname -m)" ;;
    all)       platform=""              ; archs="arm64 x86_64" ;;
    device)    platform="iphoneos"      ; archs="arm64" ;;
    simulator) platform="iphonesimulator"; archs="$(uname -m)" ;;
    *) echo "usage: $0 [both|simulator|device|all]" >&2; exit 1 ;;
esac

# Which slices libsession builds, named as its own build directories are.
slices=""
for arch in $archs; do
    case "$platform" in
        iphoneos) ;;
        *) slices="$slices sim-$arch" ;;
    esac
done
case "$platform" in
    iphonesimulator) ;;
    *) case " $archs " in *" arm64 "*) slices="$slices ios-arm64" ;; esac ;;
esac

# **The hash is the honest half of BUILT.json**; the commit alone is not. The nested submodules are
# routinely carrying uncommitted patches -- the `StaticBuild.cmake` ones are, right now -- and a
# commit says nothing about them. It is the legacy client's own check
# (`Scripts/build_libSession_util.sh`): every tracked path across every submodule, hashed by
# content from the working tree, so an uncommitted edit changes it. Tests, docs and markdown are
# left out because they cannot affect what gets linked.
source_hash=$( \
    ( cd "$libsession" && git ls-files --recurse-submodules ) \
    | grep -vE '/(tests?|docs?|examples?)/|\.md$|/(\.DS_Store|\.gitignore)$' \
    | sort | tr '\n' '\0' \
    | ( cd "$libsession" && xargs -0 md5 -r ) \
    | awk '{print $1}' | sort | md5 -q \
)

build_libsession() {
    ( cd "$libsession" && env ARCHS="$archs" PLATFORM_NAME="$platform" CONFIGURATION=Debug \
        ./utils/ios.sh "" true true true false )
}

tree="$libsession/build-ios"
if [ "${SESSION_LIBSESSION_IOS_KEEP_BUILD:-0}" = 1 ]; then
    # Bypasses the cache: while changing libsession, every edit would be an entry of its own.
    build_libsession
    built="$tree"
else
    # Shared by every clone on this machine. Bump v1 whenever what an entry holds changes.
    cache_root="${SESSION_LIBSESSION_IOS_CACHE:-$HOME/Library/Caches/session-app}/libsession-ios"
    xcode_build="$(xcodebuild -version | awk '/Build version/ {print $3}')"
    built="$cache_root/v1-$source_hash-${platform:-both}-${archs// /+}-${IPHONEOS_DEPLOYMENT_TARGET:-default}-$xcode_build"

    if [ -d "$built" ]; then
        touch "$built"
        echo "libsession from cache: $built"
    else
        build_libsession

        # Renamed into place whole, so a concurrent build never reads half an entry.
        incoming="$cache_root/.incoming-$$"
        trap 'rm -rf "$incoming"' EXIT
        mkdir -p "$incoming"
        cp -cR "$tree/libsession-util.xcframework" "$incoming/"
        for slice in $slices; do
            mkdir -p "$incoming/$slice"
            ( cd "$tree/$slice" \
                && find libsession-util.a static-deps external/session-sqlite \( -name '*.a' -o -path 'static-deps/include/*' \) \
                | cpio -pdm --quiet "$incoming/$slice" )
        done
        [ -e "$built" ] || mv "$incoming" "$built"
        # A concurrent build's mv lands inside the entry rather than failing.
        rm -rf "${built:?}/${incoming##*/}"

        rm -rf "$tree"
        ls -1td "$cache_root"/v*-* | tail -n +6 | while read -r stale; do rm -rf "$stale"; done
        find "$cache_root" -maxdepth 1 -name '.incoming-*' -mtime +1 -exec rm -rf {} +
    fi
fi

framework="$built/libsession-util.xcframework"
[ -d "$framework" ] || { echo "no xcframework at $framework" >&2; exit 1; }

mkdir -p "$here/../ios"
rm -rf "$here/../ios/libsession-util.xcframework"
cp -cR "$framework" "$here/../ios/libsession-util.xcframework"
echo "xcframework in place: packages/bridge-rn/ios/libsession-util.xcframework"

# The shim, built by CMake for each slice.
#
# CocoaPods compiles only what lives inside the pod directory - a source glob reaching up into
# packages/bridge-core is dropped in silence, and the first sign of it is our own ClientBridge
# symbols missing at link time. So bridge-core is a CMake project here exactly as it is for the
# Node addon and for Android, and the pod vendors what it produces.

# Read from the podspec rather than written down twice: the shim and the pod that vendors it have
# to agree on the floor, and the podspec is the one the build actually enforces.
deployment_target="${IOS_DEPLOYMENT_TARGET:-$(sed -n 's/.*:ios *=> *"\([0-9.]*\)".*/\1/p' "$here/../SessionBridgeRN.podspec")}"
[ -n "$deployment_target" ] || { echo "no :ios platform in SessionBridgeRN.podspec - set IOS_DEPLOYMENT_TARGET" >&2; exit 1; }

staging="$repo/packages/bridge-core/build-ios/staging"
rm -rf "$staging"
mkdir -p "$staging"

for slice in $slices; do
    case "$slice" in
        sim-arm64)  cmake_platform="SIMULATORARM64" ;;
        sim-x86_64) cmake_platform="SIMULATOR64" ;;
        ios-arm64)  cmake_platform="OS64" ;;
        *) echo "no CMake platform known for slice $slice" >&2; exit 1 ;;
    esac

    build="$repo/packages/bridge-core/build-ios/$slice"
    cmake -G Ninja -S "$repo/packages/bridge-core" -B "$build" \
        -DCMAKE_TOOLCHAIN_FILE="$libsession/external/ios-cmake/ios.toolchain.cmake" \
        -DPLATFORM="$cmake_platform" \
        -DDEPLOYMENT_TARGET="$deployment_target" \
        -DENABLE_BITCODE=OFF \
        -DCMAKE_BUILD_TYPE=Release \
        -DSESSION_BRIDGE_LIBSESSION_BUNDLE="$built/$slice/libsession-util.a"
    cmake --build "$build" --target session-bridge-core --parallel

    # One library per slice in an xcframework, because `vendored_libraries` has no per-SDK form:
    # a directory of archives is a directory for exactly one slice. libsession's bundle carries
    # every library it links, so the shim's own archive is all this one holds.
    mkdir -p "$staging/$slice"
    libtool -static -no_warning_for_no_symbols -o "$staging/$slice/libSessionBridgeCore.a" \
        "$build/libsession-bridge-core.a"
done

# One library per platform: the simulator arches are a single fat archive, the device its own.
#
# **Every slice's library has to have the same filename**, which is why each lives in a directory
# of its own rather than being named after its slice. CocoaPods refuses an xcframework whose
# slices disagree about it, and says so as "because it contains static libraries" -- which reads
# as static libraries being unsupported rather than as two files being named differently.
#
# Headers go in beside them, as libsession's own xcframework gives its slices theirs.
headers="$repo/packages/bridge-core/include"
sim_slices=""
for slice in $slices; do
    case "$slice" in sim-*) sim_slices="$sim_slices $staging/$slice/libSessionBridgeCore.a" ;; esac
done
create_args=""
if [ -n "$sim_slices" ]; then
    mkdir -p "$staging/simulator"
    lipo -create $sim_slices -output "$staging/simulator/libSessionBridgeCore.a"
    create_args="$create_args -library $staging/simulator/libSessionBridgeCore.a -headers $headers"
fi
case " $slices " in
    *" ios-arm64 "*)
        create_args="$create_args -library $staging/ios-arm64/libSessionBridgeCore.a -headers $headers" ;;
esac

mkdir -p "$here/../ios"
rm -rf "$here/../ios/SessionBridgeCore.xcframework"
xcodebuild -create-xcframework $create_args -output "$here/../ios/SessionBridgeCore.xcframework"

# What builds before this one left behind. The podspec no longer globs it, and an archive of a
# slice this build did not produce is exactly the kind of thing that links and then fails to run.
rm -rf "$here/../ios/lib"

# What is in the artefacts, recorded beside them.
#
# Neither xcframework says which libsession it was built from, and the slice list is only
# discoverable by listing the directories -- so a build that is quietly a rebuild of one slice
# against a submodule that has since moved looks exactly like a complete one. This is what to read
# when something links and then behaves like an older libsession.
cat > "$here/../ios/BUILT.json" <<MANIFEST
{
  "slices": [$(for slice in $slices; do printf '"%s",' "$slice"; done | sed 's/,$//')],
  "libsession": "$(git -C "$libsession" rev-parse HEAD)",
  "sourceHash": "$source_hash",
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MANIFEST

echo "shim in place: packages/bridge-rn/ios/SessionBridgeCore.xcframework ($slices )"
