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
# one slice in it, so what they are for is a rebuild while changing libsession, not a first build.
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

. "$here/../../bridge-core/scripts/libsession-cache.sh"

# **The hash is the honest half of BUILT.json**; the commit alone is not. It is the legacy client's
# own check (`Scripts/build_libSession_util.sh`), and the cache's: every tracked and every
# untracked, unignored path across every submodule, hashed by working-tree content, so an
# uncommitted patch or a new file changes it.
source_hash=$(_ls_hashes "$libsession")
source_hash=${source_hash% *}

# Each slice through the per-machine cache, with the arguments utils/ios.sh gives
# static-bundle.sh: the cache cannot run ios.sh's own build, which builds every slice in one tree
# of its own. Its merge and xcframework steps still run below, on what the cache produced.
deployment="${IPHONEOS_DEPLOYMENT_TARGET:-13}"
toolchain="$libsession/external/ios-cmake/ios.toolchain.cmake"
target="xcode$(xcodebuild -version | awk '/Build version/ {print $3}')-ios$deployment-$(md5 -q "$toolchain")"
# ios.sh's `env -i`: what an Xcode build phase exports would otherwise reach every dependency.
clean_env=(env -i PATH="$PATH" HOME="$HOME" SDKROOT="$(xcrun --sdk macosx --show-sdk-path)")
for var in SESSION_LIBSESSION_CACHE SESSION_BRIDGE_DEPS_MIRROR; do
    if [ -n "${!var:-}" ]; then clean_env+=("$var=${!var}"); fi
done
# ios.sh merges every slice directory it finds, so one left by another mode would join this build.
rm -rf "$libsession/build-ios"
for slice in $slices; do
    case "$slice" in
        sim-arm64)  ios_platform="SIMULATORARM64" ;;
        sim-x86_64) ios_platform="SIMULATOR64" ;;
        ios-arm64)  ios_platform="OS64" ;;
        *) echo "no ios-cmake platform known for slice $slice" >&2; exit 1 ;;
    esac
    "${clean_env[@]}" bash -c 'set -euo pipefail; . "$1"; shift; libsession_bundle "$@"' _ \
        "$here/../../bridge-core/scripts/libsession-cache.sh" \
        "$libsession" "$slice-$target" "$libsession/build-ios/$slice" \
        -DCMAKE_TOOLCHAIN_FILE=@SRC@/external/ios-cmake/ios.toolchain.cmake \
        -DPLATFORM="$ios_platform" \
        -DDEPLOYMENT_TARGET="$deployment" \
        -DENABLE_BITCODE=OFF \
        -DBUILD_TESTS=OFF \
        -DBUILD_STATIC_DEPS=ON \
        -DENABLE_VISIBILITY=ON \
        -DSROUTER_FULL=OFF \
        -DSROUTER_DAEMON=OFF \
        -DSUBMODULE_CHECK=OFF \
        -DCMAKE_BUILD_TYPE=Debug
done
( cd "$libsession" && env ARCHS="$archs" PLATFORM_NAME="$platform" CONFIGURATION=Debug \
    IPHONEOS_DEPLOYMENT_TARGET="$deployment" ./utils/ios.sh "" false true true false )
built="$libsession/build-ios"

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
