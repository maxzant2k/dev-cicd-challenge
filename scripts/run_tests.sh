#!/usr/bin/env bash
#
# run_tests.sh — local mirror of the CI test + AI verification stage.
#
#   1. Run `npm test`, capturing output to logs/pipeline_failure.log.
#   2. If tests fail   -> ai-resolver in `analyze` mode (post-mortem report).
#   3. If tests pass   -> ai-resolver in `verify`  mode (pre-deploy GO/NO-GO).
#
# Usage:
#   scripts/run_tests.sh                       # normal run (expect GO)
#   scripts/run_tests.sh --simulate-failure    # injects a broken test, expect NO-GO
#
# Exit code is 0 only when both jest and the verify gate are green.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

SIMULATE_FAILURE="false"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --simulate-failure) SIMULATE_FAILURE="true"; shift;;
    -h|--help)          sed -n '2,15p' "$0"; exit 0;;
    *) echo "Unknown argument: $1" >&2; exit 2;;
  esac
done

TEST_FILE="__tests__/app.test.js"
TEST_BACKUP=""
if [[ "${SIMULATE_FAILURE}" == "true" ]]; then
  TEST_BACKUP="$(mktemp -t app.test.js.bak.XXXXXX)"
  cp "${TEST_FILE}" "${TEST_BACKUP}"
  cat >> "${TEST_FILE}" <<'INJECTED_TEST'

describe('SIMULATED — injected by run_tests.sh --simulate-failure', () => {
  it('intentionally fails so the AI resolver kicks in', () => {
    expect(1 + 1).toBe(3);
  });
});
INJECTED_TEST
  # Always restore the original test file, no matter how this script exits.
  # Preserve the original exit code (the trap's last command would otherwise overwrite it).
  trap 'rc=$?; cp "${TEST_BACKUP}" "${TEST_FILE}" 2>/dev/null || true; rm -f "${TEST_BACKUP}"; exit $rc' EXIT
fi

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

banner() {
  printf '%s\n' "${BOLD}${BLUE}=========================================================${RESET}"
  printf '%s\n' "${BOLD}${BLUE}  $1${RESET}"
  printf '%s\n' "${BOLD}${BLUE}=========================================================${RESET}"
}

mkdir -p artifacts logs

banner "Stage 1/2 — npm test"
export APP_ENV="${APP_ENV:-test}"
printf '%sEnvironment:%s APP_ENV=%s\n\n' "${DIM}" "${RESET}" "${APP_ENV}"

set +e
npm test 2>&1 | tee logs/pipeline_failure.log
TEST_EXIT=${PIPESTATUS[0]}
set -e

if [[ "${TEST_EXIT}" -ne 0 ]]; then
  printf '\n%sTests failed (exit %d). Running AI resolver in analyze mode...%s\n\n' \
    "${RED}${BOLD}" "${TEST_EXIT}" "${RESET}"
  node scripts/ai-resolver.js analyze logs/pipeline_failure.log || true
  printf '\n%sReport:%s artifacts/incident_report.md\n' "${YELLOW}" "${RESET}"
  exit "${TEST_EXIT}"
fi

printf '\n%sTests passed.%s\n\n' "${GREEN}${BOLD}" "${RESET}"

banner "Stage 2/2 — AI pre-deploy verification (GO / NO-GO gate)"
set +e
node scripts/ai-resolver.js verify
VERIFY_EXIT=$?
set -e

printf '\n'
if [[ "${VERIFY_EXIT}" -eq 0 ]]; then
  printf '%sGO — pipeline would proceed to production.%s\n' "${GREEN}${BOLD}" "${RESET}"
else
  printf '%sNO-GO — production deploy would be blocked.%s\n' "${RED}${BOLD}" "${RESET}"
fi
printf '%sReport:%s artifacts/pre_deploy_verification.md\n' "${DIM}" "${RESET}"

exit "${VERIFY_EXIT}"
