#!/usr/bin/env bash
# Gets the capture image IMAGE for catalog.yml. A pull request from a branch of this repository, a
# push to main and the nightly pull it from ghcr. It is built here only where ghcr cannot have it:
# on a fork's pull request (FORK=true), whose token cannot read the private package, and when the
# tag is not published, as when a pull request changes the image. Any other ghcr failure fails, so
# a pull that should work never quietly turns into a build on every run.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

build() {
  echo "Building $IMAGE: $1"
  docker build --quiet --tag "$IMAGE" "$here/image" >/dev/null
}

if [ "${FORK:-false}" = true ]; then
  build "a fork's pull request cannot read the package"
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
