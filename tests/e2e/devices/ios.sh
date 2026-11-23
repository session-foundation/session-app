#!/usr/bin/env bash
# The phone and tablet the `ios` project runs on, for a CI runner: `up` creates and boots fresh
# simulators and prints their udids as KEY=value lines; `down` deletes them, so no run inherits
# another's keychain or Photos.
set -euo pipefail

STATE=${SESSION_E2E_DEVICES_DIR:-$HOME/.session-e2e}/ios
RUNTIME=com.apple.CoreSimulator.SimRuntime.iOS-27-2
FORMS="phone tablet"
BOOT_TIMEOUT_S=240

# macOS's bash is 3.2: no associative arrays.
device_type() {
  case $1 in
    phone) echo com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro ;;
    tablet) echo com.apple.CoreSimulator.SimDeviceType.iPad-Pro-11-inch-M5-12GB ;;
  esac
}

up() {
  mkdir -p "$STATE"
  for form in $FORMS; do
    local udid
    udid=$(xcrun simctl create "session-e2e-$form" "$(device_type "$form")" "$RUNTIME")
    echo "$udid" >"$STATE/$form.udid"
    xcrun simctl boot "$udid"
  done
  for form in $FORMS; do
    local udid waited=0
    udid=$(cat "$STATE/$form.udid")
    # `simctl bootstatus` can hang on a booted device; serving a spawn is the proof it is up.
    until xcrun simctl spawn "$udid" /usr/bin/true >/dev/null 2>&1; do
      if [ $waited -ge $BOOT_TIMEOUT_S ]; then
        echo "ios.sh: $udid did not boot in ${BOOT_TIMEOUT_S}s" >&2
        exit 1
      fi
      sleep 4
      waited=$((waited + 4))
    done
    echo "SESSION_E2E_IOS_$(echo "$form" | tr a-z A-Z)=$udid"
  done
}

down() {
  for form in $FORMS; do
    [ -f "$STATE/$form.udid" ] || continue
    local udid
    udid=$(cat "$STATE/$form.udid")
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
    rm -f "$STATE/$form.udid"
  done
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
