#!/bin/bash
set -euo pipefail

# Copies the dev photographs and their thumbnails into the dev client's own storage, where the fake reads them: an
# Android device or emulator over adb, or a booted iOS simulator.
#
# Usage: push-fake-media.sh [--android|--ios] [folder]. Without a flag it pushes to whichever of
# the two is attached, and refuses to guess when both are. With several simulators booted, name one
# with SESSION_SIMULATOR=<udid>.
#
# The folder desktop's fake reads: SESSION_FAKE_MEDIA_DIR, or ~/.cache/session-app/dev-media, which
# `pnpm fake-media:fetch` fills.

target=""
case "${1:-}" in
--android | --ios)
    target="${1#--}"
    shift
    ;;
esac

src="${1:-${SESSION_FAKE_MEDIA_DIR:-$HOME/.cache/session-app/dev-media}}"
count=$( (ls "$src"/unsplash-*.jpg 2>/dev/null || true) | wc -l | tr -d " ")
thumbnails=$( (ls "$src"/thumbnail-*.jpg 2>/dev/null || true) | wc -l | tr -d " ")
if [ "$count" -ne 30 ] || [ "$thumbnails" -ne 30 ]; then
    echo "expected 30 dev photographs and 30 thumbnails in $src, found $count and $thumbnails." \
        "Run: pnpm fake-media:fetch" >&2
    exit 1
fi

# ANDROID_HOME first, then the two default SDK locations, then whatever adb the shell knows.
find_adb() {
    local sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    if [ -z "$sdk" ]; then
        for candidate in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
            [ -x "$candidate/platform-tools/adb" ] && sdk="$candidate" && break
        done
    fi
    local adb="${sdk:+$sdk/platform-tools/adb}"
    [ -x "$adb" ] || adb="$(command -v adb || true)"
    echo "$adb"
}

adb="$(find_adb)"

android_attached() {
    [ -n "$adb" ] && "$adb" devices 2>/dev/null | grep -q $'\tdevice$'
}

ios_booted() {
    command -v xcrun >/dev/null && xcrun simctl list devices booted 2>/dev/null | grep -q Booted
}

if [ -z "$target" ]; then
    if android_attached && ios_booted; then
        echo "both an Android device and an iOS simulator are attached: pass --android or --ios" >&2
        exit 1
    elif android_attached; then
        target=android
    elif ios_booted; then
        target=ios
    else
        echo "no Android device and no booted iOS simulator found" >&2
        exit 1
    fi
fi

push_android() {
    if [ -z "$adb" ]; then
        echo "adb not found: set ANDROID_HOME, or put adb on PATH" >&2
        exit 1
    fi
    # `run-as` because the destination is the app's private directory, which only a debug build
    # of it may write to.
    local package=org.getsession.session2
    local staging=/data/local/tmp/session-fake-media
    "$adb" shell rm -rf "$staging"
    "$adb" shell mkdir -p "$staging"
    "$adb" push "$src"/unsplash-*.jpg "$src"/thumbnail-*.jpg "$staging/" >/dev/null
    "$adb" shell run-as "$package" mkdir -p files/fake-media
    "$adb" shell run-as "$package" sh -c "'cp $staging/*.jpg files/fake-media/'"
    "$adb" shell rm -rf "$staging"
}

push_ios() {
    if ! command -v xcrun >/dev/null; then
        echo "xcrun not found: the iOS simulator needs a Mac with Xcode" >&2
        exit 1
    fi
    local device="${SESSION_SIMULATOR:-booted}"
    # `booted` picks one of several without saying which.
    if [ "$device" = booted ]; then
        local booted
        booted="$(xcrun simctl list devices booted | grep -c Booted || true)"
        if [ "$booted" -gt 1 ]; then
            echo "$booted simulators are booted: name one with SESSION_SIMULATOR=<udid>" >&2
            xcrun simctl list devices booted | grep Booted >&2
            exit 1
        fi
    fi
    # app.config.ts appends SESSION_BUNDLE_SUFFIX, -test unless set, on iOS only.
    local bundle="org.getsession.session2${SESSION_BUNDLE_SUFFIX--test}"
    local container
    container="$(xcrun simctl get_app_container "$device" "$bundle" data 2>/dev/null || true)"
    # Empty also when the simulator reports Booted without serving requests; see the run skill's
    # references/ios.md.
    if [ -z "$container" ]; then
        echo "no data container for $bundle on simulator $device: install the app first" >&2
        exit 1
    fi
    mkdir -p "$container/Documents/fake-media"
    cp "$src"/unsplash-*.jpg "$src"/thumbnail-*.jpg "$container/Documents/fake-media/"
}

"push_$target"
echo "pushed $count photographs and their thumbnails from $src to $target; restart the app to pick them up"
