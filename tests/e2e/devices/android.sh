#!/usr/bin/env bash
# The phone and tablet the `android` project runs on, for a CI runner: `up` boots both from AVDs
# of the runner's own and prints the serials as KEY=value lines; `down` stops them.
#
# Kept apart from a developer's emulators on the same host: AVDs under SESSION_E2E_DEVICES_DIR,
# console ports outside session-qa-2's `emu` range (5600-5678), and an adb server on
# ANDROID_ADB_SERVER_PORT when that is set.
set -euo pipefail

SDK=${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/opt/android}}
STATE=${SESSION_E2E_DEVICES_DIR:-$HOME/.session-e2e/android}
export ANDROID_AVD_HOME=$STATE/avd ANDROID_EMULATOR_HOME=$STATE
ADB=$SDK/platform-tools/adb
EMULATOR=$SDK/emulator/emulator
AVDMANAGER=$SDK/cmdline-tools/latest/bin/avdmanager

# The devices the specs were written against: the API 34 image, a Pixel 6 and a Pixel Tablet.
IMAGE='system-images;android-34;google_apis_playstore;x86_64'
FORMS=(phone tablet)
declare -A DEVICE=([phone]=pixel_6 [tablet]=pixel_tablet)
declare -A PORT=([phone]=5710 [tablet]=5712)
BOOT_TIMEOUT_S=300

avd() { echo "session-e2e-$1"; }

create() {
  local form=$1 name
  name=$(avd "$form")
  [ -f "$ANDROID_AVD_HOME/$name.ini" ] && return
  mkdir -p "$ANDROID_AVD_HOME"
  echo no | "$AVDMANAGER" --silent create avd --name "$name" --package "$IMAGE" \
    --device "${DEVICE[$form]}" --force >/dev/null
  # As the developer AVDs are set up; software rendering, since a runner has no display.
  cat >>"$ANDROID_AVD_HOME/$name.avd/config.ini" <<EOF
hw.ramSize=3072
disk.dataPartition.size=6G
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.keyboard=yes
EOF
}

booted() {
  [ "$("$ADB" -s "$1" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]
}

up() {
  mkdir -p "$STATE/logs"
  # A Play Store image accepts only the adb keys found in the emulator's home, which is ours, and
  # a server left from an earlier run may hold another key: this port is ours, so restart it.
  local key=${ANDROID_USER_HOME:-$HOME/.android}/adbkey
  "$ADB" kill-server >/dev/null 2>&1 || true
  [ -f "$key.pub" ] || "$ADB" keygen "$key" >/dev/null
  cp "$key" "$key.pub" "$STATE/"
  ADB_VENDOR_KEYS=$key "$ADB" start-server >/dev/null
  for form in "${FORMS[@]}"; do
    create "$form"
    # Cold and wiped every time, so nothing one run leaves reaches the next.
    nohup "$EMULATOR" -avd "$(avd "$form")" -port "${PORT[$form]}" -no-window -no-audio \
      -no-boot-anim -no-snapshot -wipe-data -gpu swiftshader_indirect \
      >"$STATE/logs/$form.log" 2>&1 &
    echo $! >"$STATE/$form.pid"
  done
  for form in "${FORMS[@]}"; do
    local serial=emulator-${PORT[$form]} waited=0
    until booted "$serial"; do
      if [ $waited -ge $BOOT_TIMEOUT_S ]; then
        echo "android.sh: $serial did not boot in ${BOOT_TIMEOUT_S}s" >&2
        tail -20 "$STATE/logs/$form.log" >&2
        exit 1
      fi
      sleep 3
      waited=$((waited + 3))
    done
    echo "SESSION_E2E_ANDROID_${form^^}=$serial"
  done
}

down() {
  for form in "${FORMS[@]}"; do
    "$ADB" -s "emulator-${PORT[$form]}" emu kill >/dev/null 2>&1 || true
    if [ -f "$STATE/$form.pid" ]; then
      kill "$(cat "$STATE/$form.pid")" 2>/dev/null || true
      rm -f "$STATE/$form.pid"
    fi
  done
  "$ADB" kill-server >/dev/null 2>&1 || true
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
