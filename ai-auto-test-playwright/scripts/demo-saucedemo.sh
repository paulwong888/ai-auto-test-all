#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
MODE="${MODE:-debug}"
SEED_TESTS="${SEED_TESTS:-auto}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REFERENCE_TESTS="$REPO_ROOT/tests"
WORKSPACE_NAME="saucedemo-demo-$$"

if [ "$MODE" = "ci" ]; then
  RUN_BODY='{"headed":false,"slowmo":0}'
else
  RUN_BODY='{"headed":true,"slowmo":600}'
fi

poll_job() {
  local job_id="$1"
  local status=""
  for _ in $(seq 1 120); do
    status=$(curl -sf "$BASE/api/jobs/$job_id" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
    if [ "$status" = "completed" ] || [ "$status" = "failed" ] || [ "$status" = "cancelled" ]; then
      break
    fi
    sleep 5
  done
  if [ "$status" != "completed" ]; then
    echo "Job $job_id ended with status=$status" >&2
    curl -sf "$BASE/api/jobs/$job_id" | python3 -m json.tool >&2 || true
    exit 1
  fi
}

echo "==> 1. Create project ($BASE)"
PROJECT=$(curl -sf -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"SauceDemo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
echo "Project ID: $PROJECT"

echo "==> 2. Init template"
curl -sf -X POST "$BASE/api/projects/$PROJECT/init-template" >/dev/null

echo "==> 3. Upload recorded"
RECORDED="$REFERENCE_TESTS/recorded/saucedemo.py"
if [ ! -f "$RECORDED" ]; then
  echo "Missing $RECORDED" >&2
  exit 1
fi
curl -sf -X POST "$BASE/api/projects/$PROJECT/record/upload" \
  -F "file=@$RECORDED" \
  -F "moduleName=saucedemo" >/dev/null

should_seed() {
  if [ "$SEED_TESTS" = "always" ]; then return 0; fi
  if [ "$SEED_TESTS" = "never" ]; then return 1; fi
  if [ -z "${DASHSCOPE_API_KEY:-}" ] && [ -z "${OPENAI_API_KEY:-}" ]; then return 0; fi
  return 1
}

if should_seed; then
  echo "==> 4–5. Seed reference tests/ (skip Pi plan/code)"
  HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
  mkdir -p "$HOST_PATH/$WORKSPACE_NAME/tests"
  rsync -a --delete \
    --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
    --exclude 'test-results' --exclude '.runs' --exclude 'report.html' \
    "$REFERENCE_TESTS/" "$HOST_PATH/$WORKSPACE_NAME/tests/"
else
  echo "==> 4. Generate plan (Pi)"
  PLAN_JOB=$(curl -sf -X POST "$BASE/api/projects/$PROJECT/plan/generate" \
    -H 'Content-Type: application/json' \
    -d '{"moduleName":"saucedemo"}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
  poll_job "$PLAN_JOB"

  echo "==> 5. Generate code (Pi)"
  CODE_JOB=$(curl -sf -X POST "$BASE/api/projects/$PROJECT/code/generate" \
    -H 'Content-Type: application/json' \
    -d '{"moduleName":"saucedemo","confirmPlan":true}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
  poll_job "$CODE_JOB"
fi

echo "==> 6. Run tests (MODE=$MODE)"
RUN_ID=$(curl -sf -X POST "$BASE/api/projects/$PROJECT/run" \
  -H 'Content-Type: application/json' \
  -d "$RUN_BODY" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])')
echo "Run ID: $RUN_ID"

echo "==> 7. Poll run until finished"
for _ in $(seq 1 120); do
  RUN_JSON=$(curl -sf "$BASE/api/projects/$PROJECT/runs/$RUN_ID")
  STATUS=$(echo "$RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
  if [ "$STATUS" != "running" ] && [ "$STATUS" != "pending" ]; then
    PASSED=$(echo "$RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["passed"])')
    FAILED=$(echo "$RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["failed"])')
    echo "Run finished: status=$STATUS passed=$PASSED failed=$FAILED"
    if [ "$STATUS" = "passed" ] && [ "${PASSED:-0}" -lt 15 ]; then
      echo "Expected at least 15 passed tests, got $PASSED" >&2
      exit 1
    fi
    break
  fi
  sleep 5
done

echo "==> 8. Fetch report"
curl -sf "$BASE/api/projects/$PROJECT/runs/$RUN_ID/report" | head -c 200 >/dev/null
echo "Report OK"

if [ "${FAILED:-0}" -gt 0 ]; then
  echo "==> 9. Fix analyze (failed run)"
  FIX_JOB=$(curl -sf -X POST "$BASE/api/projects/$PROJECT/fix/analyze" \
    -H 'Content-Type: application/json' \
    -d "{\"runId\":\"$RUN_ID\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
  poll_job "$FIX_JOB"
  FIX=$(curl -sf "$BASE/api/projects/$PROJECT/runs/$RUN_ID/fix")
  echo "$FIX" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; assert d.get("analysis"), "missing analysis"; print("Fix analysis length:", len(d["analysis"]))'
else
  echo "==> 9. Skip fix/analyze (all tests passed)"
fi

echo "Demo complete. Project=$PROJECT Run=$RUN_ID"
