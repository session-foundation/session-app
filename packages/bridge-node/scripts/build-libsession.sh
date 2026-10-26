#!/bin/bash
set -euo pipefail

# Builds libsession's static bundle for the addon into build-libsession/, through the per-machine
# cache in bridge-core/scripts/libsession-cache.sh. The compilers are the addon's own: one
# libstdc++ for both, and the key names them.

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
libsession="$here/../../../libsession-util"

cc="${SESSION_BRIDGE_CC:-gcc}"
cxx="${SESSION_BRIDGE_CXX:-g++}"
compiler_id="$( { command -v "$cc" "$cxx"; "$cc" --version | head -1; "$cxx" --version | head -1; } \
    | tr '\n' ' ' | cksum | cut -d' ' -f1)"

. "$here/../../bridge-core/scripts/libsession-cache.sh"
libsession_bundle "$libsession" "desktop-$(uname -s)-$(uname -m)-$compiler_id" \
    "$here/../build-libsession" \
    -DCMAKE_C_COMPILER="$cc" \
    -DCMAKE_CXX_COMPILER="$cxx" \
    -DUSE_LTO=OFF \
    -DSUBMODULE_CHECK=OFF
