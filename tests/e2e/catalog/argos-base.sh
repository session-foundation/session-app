#!/usr/bin/env bash
# Keeps a pull request's Argos comparison on the build it should use when several runners capture
# at once. `await`, before the upload: waits while the run that build comes from is capturing.
# `check`, after it: fails when Argos compared with another build and a rerun would fix that, and
# warns when the right build captured other files than this pull request is merged onto.
# `reference`, first: prints, for $GITHUB_ENV, the build a stacked pull request compares with.
# Takes GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA; for `reference` PR_NUMBER and
# GITHUB_DEFAULT_BRANCH; then what it printed (ARGOS_REFERENCE_COMMIT, ARGOS_BELOW_HEAD,
# ARGOS_BELOW_REF, or ARGOS_BASELINE_UNKNOWN), and for `check` ARGOS_TOKEN, ARGOS_API_BASE_URL,
# CATALOG_TIER and UPLOAD_LOG.
set -uo pipefail

mode=${1:?usage: argos-base.sh reference|await|check}

# GitHub merges a pull request onto main's head, or, in a stack, onto the pull request below: onto
# its head in a stack of ordinary pull requests, onto its own merge commit in a native stack. Argos
# stores a pull request's build under that merge commit, so the commit merged onto names the build
# below either way. Runs are listed by the head they were built from: the head below, which is
# read from that commit rather than from the pull request, whose base may have moved on since.
reference() {
  local onto status below ref
  if ! onto=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.parents[0].sha') ||
    ! status=$(gh api "repos/$GITHUB_REPOSITORY/compare/$onto...${GITHUB_DEFAULT_BRANCH:-main}" --jq .status); then
    echo "::warning::Could not tell whether this pull request is stacked, so its Argos baseline is not checked" >&2
    echo "ARGOS_BASELINE_UNKNOWN=1"
    return 0
  fi
  echo "Merged onto ${onto:0:8}; the event's base is ${GITHUB_BASE_REF:-none}" >&2
  # On main's line: Argos takes main's build by itself.
  case $status in identical | ahead) return 0 ;; esac
  # Only GitHub's own merge commit says "Merge <head> into <base>"; a branch's merges name branches.
  if ! below=$(gh api "repos/$GITHUB_REPOSITORY/commits/$onto" --jq \
    'if (.commit.message | test("^Merge [0-9a-f]{40} into [0-9a-f]{40}$")) then .parents[1].sha else .sha end'); then
    echo "::warning::Could not read ${onto:0:8}, so this pull request's Argos baseline is not checked" >&2
    echo "ARGOS_BASELINE_UNKNOWN=1"
    return 0
  fi
  # Its name, for the messages only.
  ref=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$PR_NUMBER" --jq .base.ref) || ref=${GITHUB_BASE_REF:-}
  echo "ARGOS_REFERENCE_COMMIT=$onto"
  echo "ARGOS_BELOW_HEAD=$below"
  echo "ARGOS_BELOW_REF=${ref:-the pull request below}"
}

if [ "$mode" = reference ]; then
  reference
  exit 0
fi

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
  runs=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs?head_sha=${ARGOS_BELOW_HEAD:-$base}&per_page=50" --jq \
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
  local used_sha onto used_commit onto_tree used_tree used_head
  if [ -n "${ARGOS_BASELINE_UNKNOWN:-}" ]; then
    echo "::warning::Which build this pull request compares with is not known, so its baseline is not checked"
    return 0
  fi
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
  used_sha=$(jq -r '.base.sha // ""' <<<"$build")
  if [ -n "$stacked" ]; then
    wanted="the build of ${ARGOS_BELOW_REF:-$GITHUB_BASE_REF} at ${base:0:8}, the pull request below"
  else
    wanted="main's build of ${base:0:8}, the commit this pull request is merged onto"
  fi

  # Argos stores a pull request's build under GitHub's merge commit, not the head it was built from,
  # so the build it compared with is judged by the files it captured.
  if [ -n "$used_sha" ]; then
    onto=$base
    if [ -n "$stacked" ] && ! onto=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA" --jq '.parents[0].sha'); then
      echo "::warning::Could not resolve the commit this pull request is merged onto, so the baseline of $url is not checked"
      return 0
    fi
    [ "$used_sha" = "$onto" ] && return 0
    if ! used_commit=$(gh api "repos/$GITHUB_REPOSITORY/git/commits/$used_sha" --jq '"\(.tree.sha) \(.parents[1].sha // "")"') ||
      ! onto_tree=$(gh api "repos/$GITHUB_REPOSITORY/git/commits/$onto" --jq .tree.sha); then
      echo "::warning::Could not compare the files of ${used_sha:0:8} and ${onto:0:8}, so the baseline of $url is not checked"
      return 0
    fi
    read -r used_tree used_head <<<"$used_commit"
    [ "$used_tree" = "$onto_tree" ] && return 0
    # A rerun captures the same merge commit and gets the same build, so only a push can fix this.
    if [ -n "$stacked" ] && { [ "$used_sha" = "$base" ] || [ "$used_head" = "$base" ]; }; then
      echo "::warning::$url compared with $used, the build of ${ARGOS_BELOW_REF:-$GITHUB_BASE_REF} at ${base:0:8}, but that build captured other files than this pull request is merged onto, so it may show changes that are not this pull request's. Merge main into ${ARGOS_BELOW_REF:-$GITHUB_BASE_REF} and up through the stack, then push."
      return 0
    fi
  fi

  # Only fail where a rerun can do better: Argos holds a build there it can compare with, or a run
  # there is still going. Argos passes over a rejected build and one it could not process, and a
  # build stays pending for hours after its upload dies.
  if ! expected=$(expected_build_status "${api%/*}"); then
    expected=unknown
  fi
  case $expected in
    accepted | no-changes | changes-detected | progress) ;;
    *)
      if ! jobs=$(unfinished_jobs) || [ -z "$jobs" ]; then
        case $expected in
          "") why="No such build exists, and no catalog run on ${base:0:8} is going." ;;
          unknown) why="That build could not be looked up." ;;
          pending) why="That build's upload never finished, and Argos does not compare with it." ;;
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
  *) echo "usage: argos-base.sh reference|await|check" >&2 && exit 2 ;;
esac
