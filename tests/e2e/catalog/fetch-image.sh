#!/usr/bin/env bash
# Gets the capture image IMAGE for catalog.yml. A pull request from a branch of this repository, a
# push to main and the nightly pull it from ghcr, and fail on any ghcr error other than a tag not
# published yet (a pull request that changes the image), so a pull that should work never quietly
# turns into a build on every run. A fork's pull request (FORK=true) pulls anonymously, which works
# once the package is public, and builds on any failure.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

build() {
  echo "Building $IMAGE: $1"
  docker build --quiet --tag "$IMAGE" "$here/image" >/dev/null
}

if [ "${FORK:-false}" = true ]; then
  if refused=$(docker pull --quiet "$IMAGE" 2>&1 >/dev/null); then
    echo "Pulled $IMAGE"
  else
    build "a fork's pull request could not pull it (${refused##*: })"
  fi
  exit 0
fi

echo "$GHCR_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin >/dev/null
if ! found=$(docker manifest inspect "$IMAGE" 2>&1 >/dev/null); then
  case $found in
    *"manifest unknown"* | *"no such manifest"*) build "not published" ;;
    *)
      echo "ghcr refused $IMAGE: $found" >&2
      exit 1
      ;;
  esac
  exit 0
fi
docker pull --quiet "$IMAGE" >/dev/null
echo "Pulled $IMAGE"
