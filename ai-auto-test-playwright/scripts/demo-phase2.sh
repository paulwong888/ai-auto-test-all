#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3002}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFERENCE_TESTS="$(cd "$SCRIPT_DIR/../.." && pwd)/tests"
WORKSPACE_NAME="phase2-demo-$$"
HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ai-auto-test-playwright-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_auto_test_playwright}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

TEST_LOGIN_REL="tests/specs/test_login.py"
NODE_TC001="specs/test_login.py::TestLogin::test_tc001_login_success"

poll_run() {
  local pid="$1"
  local run_id="$2"
  local max="${3:-120}"
  local json=""
  for _ in $(seq 1 "$max"); do
    json=$(curl -sf "$BASE/api/projects/$pid/runs/$run_id")
    local status
    status=$(echo "$json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
    if [ "$status" != "running" ] && [ "$status" != "pending" ]; then
      echo "$json"
      return 0
    fi
    sleep 5
  done
  echo "Run $run_id did not finish in time" >&2
  echo "$json" | python3 -m json.tool >&2 || true
  exit 1
}

start_ci_run() {
  local pid="$1"
  curl -sf -X POST "$BASE/api/projects/$pid/run" \
    -H 'Content-Type: application/json' \
    -d '{"preset":"ci"}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])'
}

break_tc001() {
  local file="$HOST_PATH/$WORKSPACE_NAME/$TEST_LOGIN_REL"
  python3 - "$file" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "inventory.assert_loaded()"
if needle not in text:
    raise SystemExit(f"missing {needle!r} in {path}")
path.write_text(text.replace(needle, 'expect(page.locator("#broken-tc001")).to_be_visible()', 1))
PY
}

restore_tc001_file() {
  local file="$HOST_PATH/$WORKSPACE_NAME/$TEST_LOGIN_REL"
  python3 - "$file" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
broken = 'expect(page.locator("#broken-tc001")).to_be_visible()'
if broken not in text:
    raise SystemExit(f"missing broken locator in {path}")
path.write_text(text.replace(broken, "inventory.assert_loaded()", 1))
PY
}

seed_fix_suggestion() {
  local run_id="$1"
  local suggestion_id="$2"
  docker exec -i "$POSTGRES_CONTAINER" psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO fix_suggestions (id, run_id, analysis_md, failing_tests, patches, iteration)
VALUES (
  '$suggestion_id',
  '$run_id',
  '## Wave 1 seeded fix\n\nRestore TC-001 login assertion.',
  '[{"tc":"TC-001","nodeId":"$NODE_TC001","error":"Broken locator #broken-tc001"}]'::jsonb,
  '[{"file":"$TEST_LOGIN_REL","unifiedDiff":"--- a/tests/specs/test_login.py\n+++ b/tests/specs/test_login.py\n@@ -21,4 +21,4 @@\n         login.login(username, password)\n \n         inventory = InventoryPage(page)\n-        expect(page.locator(\"#broken-tc001\")).to_be_visible()\n+        inventory.assert_loaded()\n","description":"Restore inventory.assert_loaded()"}]'::jsonb,
  1
);
SQL
}

insert_fix_iterations() {
  local run_id="$1"
  local suggestion_id="$2"
  docker exec -i "$POSTGRES_CONTAINER" psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO fix_iterations (id, run_id, iteration, suggestion_id, patches_applied, result)
VALUES
  ('$(python3 -c 'import uuid; print(uuid.uuid4())')', '$run_id', 2, '$suggestion_id', '[]'::jsonb, 'failed'),
  ('$(python3 -c 'import uuid; print(uuid.uuid4())')', '$run_id', 3, '$suggestion_id', '[]'::jsonb, 'failed');
SQL
}

echo "==> 1. Create project + seed tests"
PID=$(curl -sf -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Phase2Demo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')

curl -sf -X POST "$BASE/api/projects/$PID/init-template" >/dev/null
curl -sf -X POST "$BASE/api/projects/$PID/record/upload" \
  -F "file=@$REFERENCE_TESTS/recorded/saucedemo.py" \
  -F "moduleName=saucedemo" >/dev/null

mkdir -p "$HOST_PATH/$WORKSPACE_NAME/tests"
rsync -a --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
  --exclude 'test-results' --exclude '.runs' \
  "$REFERENCE_TESTS/" "$HOST_PATH/$WORKSPACE_NAME/tests/"

echo "==> 2. Plan v1"
V1=$(curl -sf -X PUT "$BASE/api/projects/$PID/plan" \
  -H 'Content-Type: application/json' \
  -d '{"content":"# Plan\n\n## TC-001 Login\n","moduleName":"saucedemo"}')
V1_ID=$(echo "$V1" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; assert d["versionNumber"]==1; print(d["id"])')

echo "==> 3. Plan v2 with baseVersionId + diff"
V2=$(curl -sf -X PUT "$BASE/api/projects/$PID/plan" \
  -H 'Content-Type: application/json' \
  -d "{\"content\":\"# Plan\\n\\n## TC-001 Login\\n## TC-016 Extra\\n\",\"moduleName\":\"saucedemo\",\"baseVersionId\":\"$V1_ID\",\"message\":\"add TC-016\"}")
V2_ID=$(echo "$V2" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; assert d["versionNumber"]==2; print(d["id"])')

DIFF=$(curl -sf "$BASE/api/projects/$PID/plan/diff?v1=$V1_ID&v2=$V2_ID" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["diff"])')
echo "$DIFF" | grep -q "TC-016" || { echo "plan diff missing TC-016" >&2; exit 1; }

echo "==> 4. CI run (timing <180s)"
CI_START=$(date +%s)
RUN_PASS=$(start_ci_run "$PID")
RUN_PASS_JSON=$(poll_run "$PID" "$RUN_PASS")
CI_ELAPSED=$(( $(date +%s) - CI_START ))
echo "$RUN_PASS_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert d["status"]=="passed", d
assert d["passed"]>=15, d
print("CI run passed=%s failed=%s" % (d["passed"], d["failed"]))
'
if [ "$CI_ELAPSED" -ge 180 ]; then
  echo "CI run took ${CI_ELAPSED}s (>=180s)" >&2
  exit 1
fi
echo "CI elapsed=${CI_ELAPSED}s"

echo "==> 5. Break TC-001 + failed run + compare + rerunFailedOnly"
break_tc001
RUN_FAIL=$(start_ci_run "$PID")
RUN_FAIL_JSON=$(poll_run "$PID" "$RUN_FAIL")
echo "$RUN_FAIL_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert d["status"]=="failed", d
assert d["failed"]>=1, d
assert any("test_tc001" in n for n in d.get("failedNodeIds", [])), d
print("Failed run failed=%s nodeIds=%s" % (d["failed"], d.get("failedNodeIds", [])))
'

COMPARE_AB=$(curl -sf "$BASE/api/projects/$PID/runs/compare?runA=$RUN_PASS&runB=$RUN_FAIL")
echo "$COMPARE_AB" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert "TC-001" in d["newFailures"], d
assert d["fixed"]==[], d
print("compare pass->fail:", d)
'

RERUN=$(curl -sf -X POST "$BASE/api/projects/$PID/run" \
  -H 'Content-Type: application/json' \
  -d "{\"preset\":\"ci\",\"rerunFailedOnly\":true,\"previousRunId\":\"$RUN_FAIL\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])')
RERUN_JSON=$(poll_run "$PID" "$RERUN")
echo "$RERUN_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
total=d["passed"]+d["failed"]+d["skipped"]
assert total==1, f"expected 1 test rerun, got total={total} ({d})"
print("rerunFailedOnly total=%s status=%s" % (total, d["status"]))
'

echo "==> 6. stats/trend"
TREND=$(curl -sf "$BASE/api/projects/$PID/stats/trend?days=7")
echo "$TREND" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]["trend"]
assert isinstance(d, list) and len(d)>=1, d
print(f"trend points={len(d)}")
'

echo "==> 7. Seed fix_suggestion + fix/apply autoVerify + poll verify pass"
SUGGESTION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')
seed_fix_suggestion "$RUN_FAIL" "$SUGGESTION_ID"

APPLY=$(curl -sf -X POST "$BASE/api/projects/$PID/fix/apply" \
  -H 'Content-Type: application/json' \
  -d "{\"suggestionId\":\"$SUGGESTION_ID\",\"patchIndexes\":[0],\"autoVerify\":true}")
VERIFY_RUN=$(echo "$APPLY" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; assert d["verifyRunId"]; print(d["verifyRunId"])')

VERIFY_JSON=$(poll_run "$PID" "$VERIFY_RUN" 60)
echo "$VERIFY_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert d["status"]=="passed", d
assert d["failed"]==0, d
print("verify run passed=%s" % d["passed"])
'

COMPARE_FIX=$(curl -sf "$BASE/api/projects/$PID/runs/compare?runA=$RUN_FAIL&runB=$VERIFY_RUN")
echo "$COMPARE_FIX" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert "TC-001" in d["fixed"], d
assert d["newFailures"]==[], d
print("compare fail->verify:", d)
'

echo "==> 8. FIX_ITERATION_LIMIT (insert iterations 2,3 -> 4th apply 422)"
break_tc001
LIMIT_RUN=$(start_ci_run "$PID")
poll_run "$PID" "$LIMIT_RUN" >/dev/null
LIMIT_SUGGESTION=$(python3 -c 'import uuid; print(uuid.uuid4())')
seed_fix_suggestion "$LIMIT_RUN" "$LIMIT_SUGGESTION"
insert_fix_iterations "$LIMIT_RUN" "$LIMIT_SUGGESTION"

HTTP=$(curl -s -o /tmp/phase2-limit.json -w '%{http_code}' -X POST "$BASE/api/projects/$PID/fix/apply" \
  -H 'Content-Type: application/json' \
  -d "{\"suggestionId\":\"$LIMIT_SUGGESTION\",\"patchIndexes\":[0],\"autoVerify\":false}")
if [ "$HTTP" != "422" ]; then
  echo "Expected 422 for iteration limit, got $HTTP" >&2
  cat /tmp/phase2-limit.json >&2
  exit 1
fi
python3 -c '
import json
d=json.load(open("/tmp/phase2-limit.json"))
assert d["ok"] is False
assert d["error"]["code"]=="FIX_ITERATION_LIMIT", d
print("FIX_ITERATION_LIMIT OK")
'

restore_tc001_file

echo "Phase 2 demo complete. Project=$PID passRun=$RUN_PASS failRun=$RUN_FAIL verifyRun=$VERIFY_RUN (${CI_ELAPSED}s CI)"
