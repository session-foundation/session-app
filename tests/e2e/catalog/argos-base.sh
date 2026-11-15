#!/usr/bin/env bash
# Keeps a pull request's Argos comparison on the build it should use when several runners capture
# at once. `await`, before the upload: waits while the run that build comes from is capturing.
# `check`, after it: fails when Argos compared with another build and a rerun would fix that.
# Takes GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA and GITHUB_BASE_REF, ARGOS_REFERENCE_COMMIT for a
# stacked pull request, and for `check` ARGOS_TOKEN, ARGOS_API_BASE_URL, CATALOG_TIER and
# UPLOAD_LOG.
set -uo pipefail

mode=${1:?usage: argos-base.sh await|check}
stacked=${ARGOS_REFERENCE_COMMIT:-}

# Argos takes the merge base with main of the commit built, GitHub's merge commit: main's head when
# the merge was made, its first parent. A stacked pull request names the head below it instead.
if ! base=${stacked:-$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.parents[0].sha')}; then
  echo "::warning::Could not resolve the commit Argos compares this pull request with"
  exit 0
fi

# The jobs still going in the catalog runs on the base commit, as queued or in_progress. A
# scheduled run uploads a nightly build; a dispatched one is on the pr tier unless told otherwise.
unfinished_jobs() {
  local runs
  runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$base&per_page=50" --jq \
    '.workflow_runs[] | select(.name == "catalog" and .status != "completed" and .event != "schedule") | .id') ||
    return 1
  for run in $runs; do
    gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run/jobs" --jq '.jobs[] | select(.status != "completed") | .status' ||
      return 1
  done
}

await() {
  local deadline=$((SECONDS + 20 * 60)) jobs
  while ((SECONDS < deadline)); do
    if ! jobs=$(unfinished_jobs); then
      echo "::warning::Could not list the catalog runs on $base; uploading without waiting for them"
      return
    fi
    [ -z "$jobs" ] && return
    # A queued one may be waiting for the runner this job holds, so waiting for it could hold both.
    if ! grep -qx in_progress <<<"$jobs"; then
      echo "::warning::The catalog run on $base has not started, so Argos may compare with an older build"
      return
    fi
    echo "Waiting for the catalog run on $base to upload"
    sleep 15
  done
  echo "::warning::The catalog run on $base is still going after 20 minutes"
}

# The status of Argos's newest build of this tier on the base commit, empty when it has none.
expected_build_status() {
  curl -fsS -G -H "Authorization: Bearer $ARGOS_TOKEN" --data-urlencode "headSha=$base" \
    --data-urlencode "search=catalog-$CATALOG_TIER" --data-urlencode perPage=1 "$1" |
    jq -r '.results[0].status // ""'
}

check() {
  local url build status used wanted expected why jobs
  # The upload skips itself without a token.
  if [ -z "${ARGOS_TOKEN:-}" ]; then
    echo "::warning::No ARGOS_TOKEN, so no Argos baseline to check"
    return 0
  fi
  if [ ! -f "$UPLOAD_LOG" ]; then
    echo "::error::No upload log at $UPLOAD_LOG, so the Argos baseline cannot be checked"
    return 1
  fi
  # A log without the URL is an upload whose output changed, which would turn this check off unseen.
  url=$(grep -oE 'https?://[^ ]+/builds/[0-9]+' "$UPLOAD_LOG" | tail -1)
  if [ -z "$url" ]; then
    echo "::error::No Argos build URL in the upload's output, so its baseline cannot be checked"
    return 1
  fi
  # The app's build URL is owner/project/builds/N under the host; the API takes the same path.
  local api="${ARGOS_API_BASE_URL%/}/projects/${url#*://*/}"
  # Argos picks the baseline while it processes the build.
  for _ in $(seq 36); do
    if ! build=$(curl -fsS -H "Authorization: Bearer $ARGOS_TOKEN" "$api"); then
      echo "::warning::Could not read $url, so its baseline is not checked"
      return 0
    fi
    status=$(jq -r .status <<<"$build")
    [ "$status" != pending ] && [ "$status" != progress ] && break
    sleep 5
  done
  # Argos sets the base while it processes the build, so an unprocessed or failed one has none.
  case $status in
    pending | progress | error | aborted | expired)
      echo "::warning::$url is $status, so its baseline is not checked"
      return 0
      ;;
  esac

  used=$(jq -r 'if .base then "\(.base.branch)@\(.base.sha[0:8])" else "no build" end' <<<"$build")
  if [ -n "$stacked" ]; then
    [ "$(jq -r '.base.branch // ""' <<<"$build")" = "$GITHUB_BASE_REF" ] && return 0
    wanted="the build of $GITHUB_BASE_REF, the pull request below"
  else
    [ "$(jq -r '.base.sha // ""' <<<"$build")" = "$base" ] && return 0
    wanted="main's build of ${base:0:8}, the commit this pull request is merged onto"
  fi

  # Only fail where a rerun can do better: Argos holds a build there it can compare with, or a run
  # there is still going. Argos passes over a rejected build and one it could not process.
  if ! expected=$(expected_build_status "${api%/*}"); then
    expected=unknown
  fi
  case $expected in
    accepted | no-changes | changes-detected | pending | progress) ;;
    *)
      if ! jobs=$(unfinished_jobs) || [ -z "$jobs" ]; then
        case $expected in
          "") why="No such build exists, and no catalog run on ${base:0:8} is going." ;;
          unknown) why="That build could not be looked up." ;;
          *) why="That build is $expected, and Argos does not compare with it." ;;
        esac
        echo "::warning::$url compared with $used rather than $wanted. $why"
        return 0
      fi
      ;;
  esac
  echo "::error::$url compared with $used rather than $wanted, so it may show changes that are not this pull request's. Rerun this job once the catalog run on ${base:0:8} has finished."
  return 1
}

case $mode in
  await) await ;;
  check) check ;;
  *) echo "usage: argos-base.sh await|check" >&2 && exit 2 ;;
esac
