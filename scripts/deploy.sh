#!/usr/bin/env bash
#
# deploy.sh — trigger the CI/CD workflow on GitHub Actions and stream it live.
#
# Usage:
#   scripts/deploy.sh                        # workflow_dispatch on main
#   scripts/deploy.sh --ref develop          # workflow_dispatch on another branch
#   scripts/deploy.sh --simulate-failure     # forces health-check failure to demo rollback
#   scripts/deploy.sh --no-watch             # trigger and exit (don't stream)
#
# Requires:  GitHub CLI (`gh`) authenticated against this repo.

set -euo pipefail

cd "$(dirname "$0")/.."

WORKFLOW="ci.yml"
REF="main"
SIMULATE="false"
WATCH="true"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref)               REF="$2"; shift 2;;
    --simulate-failure)  SIMULATE="true"; shift;;
    --no-watch)          WATCH="false"; shift;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; GREEN=""; BLUE=""; RESET=""
fi

step() { printf '%s==>%s %s\n' "${BOLD}${BLUE}" "${RESET}" "$1"; }

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is not installed. https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

# Resolve the GitHub repo for this checkout. Prefer the `origin` remote so we
# do not depend on `gh repo set-default` being configured. Handles standard
# SSH (git@github.com:owner/repo), HTTPS, and custom SSH aliases
# (git@github-<alias>:owner/repo) — extracts the trailing owner/repo segment.
REPO=""
if ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null)"; then
  REPO="$(echo "${ORIGIN_URL}" \
    | sed -E 's#\.git$##; s#.*[:/]([^/:]+/[^/:]+)$#\1#')"
fi
if [[ -z "${REPO}" ]]; then
  REPO="$(gh repo view --json nameWithOwner --jq '.nameWithOwner' 2>/dev/null || true)"
fi
if [[ -z "${REPO}" ]]; then
  echo "ERROR: Could not determine the GitHub repo (no origin remote and no gh default)." >&2
  exit 1
fi

step "Repository:  ${REPO}"
step "Workflow:    ${WORKFLOW}"
step "Branch ref:  ${REF}"
step "Simulate:    ${SIMULATE}"
echo ""

step "Triggering workflow_dispatch..."
gh workflow run "${WORKFLOW}" \
  --repo "${REPO}" \
  --ref "${REF}" \
  -f "simulate_production_failure=${SIMULATE}"

# Wait for the new run to appear (gh creates it asynchronously)
step "Waiting for the new run to appear..."
RUN_ID=""
for i in $(seq 1 30); do
  RUN_ID="$(gh run list \
    --repo "${REPO}" \
    --workflow "${WORKFLOW}" \
    --branch "${REF}" \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId,status,createdAt \
    --jq '.[0].databaseId // empty')"
  if [[ -n "${RUN_ID}" ]]; then break; fi
  printf '  [%d/30] still waiting...\n' "$i"
  sleep 2
done

if [[ -z "${RUN_ID}" ]]; then
  echo "ERROR: Could not locate the dispatched run. Check 'gh run list' manually." >&2
  exit 1
fi

RUN_URL="$(gh run view --repo "${REPO}" "${RUN_ID}" --json url --jq '.url')"

printf '\n%sRun started%s\n' "${GREEN}${BOLD}" "${RESET}"
printf '  %sID:%s  %s\n' "${DIM}" "${RESET}" "${RUN_ID}"
printf '  %sURL:%s %s\n\n' "${DIM}" "${RESET}" "${RUN_URL}"

if [[ "${WATCH}" != "true" ]]; then
  step "Skipping live watch (--no-watch). Open the URL above to follow."
  exit 0
fi

step "Streaming live progress (Ctrl+C detaches — the run continues remotely)"
echo ""
# --exit-status makes gh propagate the run's success/failure as our exit code.
gh run watch --repo "${REPO}" "${RUN_ID}" --exit-status --interval 5
