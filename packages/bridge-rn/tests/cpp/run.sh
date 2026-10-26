#!/bin/bash
# Builds and runs the host C++ tests: the parts of the module that need no JSI, Nitro or libsession.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg="$here/../.."
out="${TMPDIR:-/tmp}/session-bridge-rn-tests"
mkdir -p "$out"

# The media vectors, as the TypeScript table currently reads: rewritten on every run so the C++
# side cannot pass against a stale copy.
pnpm --filter @session/client-contract --silent media-vectors:hpp "$out/media_vectors.hpp"

# ThreadSanitizer, because what these tests exist to catch is a value touched on the wrong thread.
flags=(-std=c++20 -g -O1 -fsanitize=thread -pthread
    -I"$pkg/cpp" -I"$pkg/../bridge-core/include" -I"$out")

# ThreadSanitizer cannot map its shadow memory under the address randomisation newer kernels use by
# default, so the binaries run with it off where setarch can do that.
run() {
    if command -v setarch >/dev/null; then
        setarch "$(uname -m)" -R "$1"
    else
        "$1"
    fi
}

"${CXX:-g++}" "${flags[@]}" \
    "$pkg/cpp/MediaSource.cpp" "$pkg/cpp/JsMediaSource.cpp" "$here/JsMediaSource.test.cpp" \
    -o "$out/JsMediaSource.test"
run "$out/JsMediaSource.test"

"${CXX:-g++}" "${flags[@]}" \
    "$pkg/cpp/MediaSource.cpp" "$here/MediaSource.test.cpp" -o "$out/MediaSource.test"
run "$out/MediaSource.test"

"${CXX:-g++}" "${flags[@]}" \
    "$pkg/../bridge-core/src/media_url.cpp" "$here/media_url.test.cpp" \
    -o "$out/media_url.test"
run "$out/media_url.test"

"${CXX:-g++}" "${flags[@]}" "$here/DecodeBound.test.cpp" -o "$out/DecodeBound.test"
run "$out/DecodeBound.test"
