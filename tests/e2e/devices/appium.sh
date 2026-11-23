#!/usr/bin/env bash
# An Appium server for a CI run: `up <android|ios>` installs the pinned Appium and the platform's
# driver once per runner, starts the server and prints SESSION_E2E_APPIUM_URL; `down` stops it.
set -euo pipefail

APPIUM_VERSION=3.8.0
PORT=${SESSION_E2E_APPIUM_PORT:-4733}
STATE=${SESSION_E2E_DEVICES_DIR:-$HOME/.session-e2e}/appium
# One install per version, kept between runs: npm and the driver's own build are minutes each.
ROOT=$HOME/.cache/session-e2e/appium-$APPIUM_VERSION
export APPIUM_HOME=$ROOT/home
START_TIMEOUT_S=60

# macOS's bash is 3.2: no associative arrays.
driver_for() {
  case $1 in
    android) echo uiautomator2@8.7.0 ;;
    # Xcode 27 has no Simulator.app; 12.22.8 is the first driver that opens DeviceHub instead.
    ios) echo xcuitest@12.22.8 ;;
    *) echo "appium.sh: no driver for '$1'" >&2; exit 2 ;;
  esac
}

install() {
  local driver=$1
  if [ ! -x "$ROOT/node_modules/.bin/appium" ]; then
    mkdir -p "$ROOT"
    npm install --prefix "$ROOT" --no-audit --no-fund "appium@$APPIUM_VERSION" >/dev/null
  fi
  local name=${driver%@*} version=${driver#*@} installed
  # Version and path from the manifest: a home moved after an install still lists the driver at its
  # old path, and every session then fails to load it.
  installed=$("$ROOT/node_modules/.bin/appium" driver list --installed --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s||"{}")[process.argv[1]];console.log(d?`${d.version} ${d.installPath}`:"")})' "$name" || true)
  [ "${installed%% *}" = "$version" ] && [ -f "${installed#* }/package.json" ] && return
  rm -rf "$APPIUM_HOME"
  "$ROOT/node_modules/.bin/appium" driver install "$driver" >/dev/null
}

up() {
  local platform=$1
  install "$(driver_for "$platform")"
  mkdir -p "$STATE"
  nohup "$ROOT/node_modules/.bin/appium" --address 127.0.0.1 --port "$PORT" \
    --log "$STATE/appium.log" --log-level warn >/dev/null 2>&1 &
  echo $! >"$STATE/appium.pid"
  local waited=0
  until curl -fsS "http://127.0.0.1:$PORT/status" >/dev/null 2>&1; do
    if [ $waited -ge $START_TIMEOUT_S ]; then
      echo "appium.sh: Appium did not answer on $PORT in ${START_TIMEOUT_S}s" >&2
      tail -20 "$STATE/appium.log" >&2 || true
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "SESSION_E2E_APPIUM_URL=http://127.0.0.1:$PORT"
}

down() {
  if [ -f "$STATE/appium.pid" ]; then
    kill "$(cat "$STATE/appium.pid")" 2>/dev/null || true
    rm -f "$STATE/appium.pid"
  fi
}

case "${1:-}" in
  up) up "${2:?usage: $0 up android|ios}" ;;
  down) down ;;
  *) echo "usage: $0 up android|ios | down" >&2; exit 2 ;;
esac
