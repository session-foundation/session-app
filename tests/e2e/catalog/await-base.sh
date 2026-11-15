#!/usr/bin/env bash
# Waits for the catalog run whose build Argos compares this pull request's captures with, which
# another runner can still be running. Never fails the job: at worst Argos uses an older build.
# Takes GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, and BASE_COMMIT for a stacked pull request.
set -uo pipefail

# Argos takes the merge base with main of the commit built, GitHub's merge commit: main's head
# when the merge was made, which is the merge commit's first parent.
base=${BASE_COMMIT:-$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.parents[0].sha')} ||
  exit 0

# Only push and pull_request runs upload a pr-tier build; a nightly or dispatched run on the same
# commit uploads under another build name.
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

deadline=$((SECONDS + 20 * 60))
while ((SECONDS < deadline)); do
  if ! jobs=$(unfinished_jobs); then
    echo "::warning::Could not list the catalog runs on $base; uploading without waiting for them"
    exit 0
  fi
  [ -z "$jobs" ] && exit 0
  # A queued one may be waiting for the runner this job holds, so waiting for it could hold both.
  if ! grep -qx in_progress <<<"$jobs"; then
    echo "::warning::The catalog run on $base has not started; Argos may compare with an older build. Rerun this job once that run has finished."
    exit 0
  fi
  echo "Waiting for the catalog run on $base to upload"
  sleep 15
done
echo "::warning::The catalog run on $base is still going after 20 minutes; Argos may compare with an older build"
