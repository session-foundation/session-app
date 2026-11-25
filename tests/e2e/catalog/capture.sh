#!/usr/bin/env bash
# Runs catalog.spec.ts inside the pinned image, so a capture is the same on any Linux x86_64 host.
# Takes CATALOG_TIER, CATALOG_OUT, CATALOG_SHARDS and CATALOG_PAGES like the spec; the checkout,
# its node_modules and a built desktop app come from the host.
set -euo pipefail

# The host's Electron runs inside the image, and Argos's references are x86_64 captures.
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo "capture.sh: Linux x86_64 only; on another host, read the pull request's build in Argos" >&2
  exit 1
fi

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
out=${CATALOG_OUT:-$repo/test-results/catalog}
media=${SESSION_FAKE_MEDIA_DIR:-$HOME/.cache/session-app/dev-media}

# CATALOG_IMAGE: one already pulled or built, as CI always passes. Otherwise a tag of its own, for
# captures that share a Docker daemon: a concurrent build can take a shared tag, and the image it
# named can vanish before docker run. --force: a cancelled run's container can still hold it.
if [ -n "${CATALOG_IMAGE:-}" ]; then
  image=$CATALOG_IMAGE
else
  image=session-catalog:$$-$RANDOM
  docker build --quiet --tag "$image" "$here/image" >/dev/null
  trap 'docker image rm --force "$image" >/dev/null || true' EXIT
fi
# Made here, so the container's user owns nothing the host cannot clean up.
mkdir -p "$out"

# --init: xvfb-run as the container's first process never hears that Xvfb is ready. No core:
# a crashing Electron would write hundreds of MB into the checkout, which is the working dir.
# CATALOG_CGROUP_PARENT lifts a capture out of a daemon-wide parent that throttles a host's CI.
# The screen is CAPTURE_SCREEN in catalog/captureWindow.ts; captureWindow.test.ts fails if they differ.
docker run --rm --init ${CATALOG_CGROUP_PARENT:+--cgroup-parent "$CATALOG_CGROUP_PARENT"} \
  --user "$(id -u):$(id -g)" \
  --ulimit core=0 \
  --env HOME=/tmp/home \
  --env CATALOG_TIER="${CATALOG_TIER:-pr}" --env CATALOG_OUT=/out \
  --env CATALOG_SHARDS --env CATALOG_PAGES \
  --env SESSION_FAKE_MEDIA_DIR=/media \
  --volume "$repo:$repo" --volume "$out:/out" --volume "$media:/media:ro" \
  --workdir "$repo/tests/e2e" \
  "$image" \
  xvfb-run -a -s '-screen 0 3800x8200x24' pnpm exec playwright test --project catalog "$@"
