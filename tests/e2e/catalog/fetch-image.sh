#!/usr/bin/env bash
# Gets the capture image IMAGE for catalog.yml from its public ghcr package, anonymously, so a
# fork's pull request pulls it like any other run. It is built here only when the tag is not
# published, as when a pull request changes the image. Any other ghcr failure fails, so a pull that
# should work never quietly turns into a build on every run.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)

if ! found=$(docker manifest inspect "$IMAGE" 2>&1 >/dev/null); then
  case $found in
    *"manifest unknown"* | *"no such manifest"*)
      echo "Building $IMAGE: not published"
      docker build --quiet --tag "$IMAGE" "$here/image" >/dev/null
      exit 0
      ;;
    *)
      echo "ghcr refused $IMAGE: $found" >&2
      exit 1
      ;;
  esac
fi
docker pull --quiet "$IMAGE" >/dev/null
echo "Pulled $IMAGE"
