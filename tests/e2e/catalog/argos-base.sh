#!/usr/bin/env bash
# Keeps a pull request's Argos comparison on the build it should use when several runners capture
# at once. `await`, before the upload: waits while the run that build comes from is capturing.
# `check`, after it: fails when Argos compared with another build and a rerun would fix that.
# Takes GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA and GITHUB_BASE_REF, ARGOS_REFERENCE_COMMIT for a
# stacked pull request, and for `check` ARGOS_TOKEN, ARGOS_API_BASE_URL and UPLOAD_LOG.
set -uo pipefail

mode=${1:?usage: argos-base.sh await|check}
stacked=${ARGOS_REFERENCE_COMMIT:-}

# Argos takes the merge base with main of the commit built, GitHub's merge commit: main's head when
# the merge was made, its first parent. A stacked pull request names the head below it instead.
if ! base=${stacked:-$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.parents[0].sha')}; then
  echo "::warning::Could not resolve the commit Argos compares this pull request with"
  exit 0
fi

# The catalog runs on the base commit that upload a pr-tier build, as "status conclusion" lines: a
# nightly or dispatched run on the same commit uploads under another build name.
base_runs() {
  gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$base&per_page=50" --jq \
    '.workflow_runs[] | select(.name == "catalog" and (.event == "push" or .event == "pull_request")) | "\(.status) \(.conclusion)"'
}

# The jobs of those runs still going, as their status: queued or in_progress.
unfinished_jobs() {
  local runs
  runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=$base&per_page=50" --jq \
    '.workflow_runs[] | select(.name == "catalog" and .status != "completed" and (.event == "push" or .event == "pull_request")) | .id') ||
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

check() {
  local url build status used wanted runs
  # No log: the upload was skipped, for want of a token.
  if [ ! -f "$UPLOAD_LOG" ]; then
    echo "::warning::No upload, so no Argos baseline to check"
    return 0
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

  # Only fail where a rerun can do better: a run on that commit is still going or has uploaded. A
  # failed one may have stopped before its upload, and then a rerun of this job cannot help.
  if ! runs=$(base_runs) || ! grep -qE '^(queued|in_progress|waiting|pending|requested) |^completed success$' <<<"$runs"; then
    echo "::warning::$url compared with $used rather than $wanted, which has no catalog build to wait for"
    return 0
  fi
  echo "::error::$url compared with $used rather than $wanted, so it may show changes that are not this pull request's. Rerun this job once the catalog run on ${base:0:8} has finished."
  return 1
}

case $mode in
  await) await ;;
  check) check ;;
  *) echo "usage: argos-base.sh await|check" >&2 && exit 2 ;;
esac
