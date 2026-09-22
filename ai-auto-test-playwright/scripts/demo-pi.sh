#!/usr/bin/env bash
# Pi Wave: real plan/code/fix via Pi (SEED_TESTS=never). Requires DASHSCOPE_API_KEY in server container.
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFERENCE_TESTS="$(cd "$SCRIPT_DIR/../.." && pwd)/tests"
WORKSPACE_NAME="pi-demo-$$"
HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
PI_JOB_MAX_POLLS="${PI_JOB_MAX_POLLS:-360}"
RUN_MAX_POLLS="${RUN_MAX_POLLS:-180}"
PI_RUN_SPEC="${PI_RUN_SPEC:-specs/test_login.py}"
RUN_BODY="${RUN_BODY:-{\"preset\":\"ci\",\"specFilter\":\"$PI_RUN_SPEC\"}}"
SERVER_CONTAINER="${SERVER_CONTAINER:-ai-auto-test-playwright-server}"

require_pi_key() {
  if docker exec "$SERVER_CONTAINER" sh -c 'test -n "${DASHSCOPE_API_KEY:-}"' 2>/dev/null; then
    return 0
  fi
  if [ -n "${DASHSCOPE_API_KEY:-}" ] || [ -n "${OPENAI_API_KEY:-}" ]; then
    return 0
  fi
  echo "DASHSCOPE_API_KEY not configured in $SERVER_CONTAINER or host env" >&2
  echo "Add to docker/.env.local and restart server: cd docker && docker-compose up -d server" >&2
  exit 1
}

poll_job() {
  local job_id="$1"
  local label="${2:-job}"
  local status=""
  local err=""
  for _ in $(seq 1 "$PI_JOB_MAX_POLLS"); do
    status=$(curl -sf "$BASE/api/jobs/$job_id" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
    if [ "$status" = "completed" ] || [ "$status" = "failed" ] || [ "$status" = "cancelled" ]; then
      break
    fi
    sleep 5
  done
  if [ "$status" != "completed" ]; then
    err=$(curl -sf "$BASE/api/jobs/$job_id" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d.get("error") or "")' || true)
    echo "$label $job_id ended with status=$status error=$err" >&2
    curl -sf "$BASE/api/jobs/$job_id" | python3 -m json.tool >&2 || true
    exit 1
  fi
}

poll_run() {
  local pid="$1"
  local run_id="$2"
  local json=""
  for _ in $(seq 1 "$RUN_MAX_POLLS"); do
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
    -d "$RUN_BODY" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])'
}

break_first_spec() {
  local root="$HOST_PATH/$WORKSPACE_NAME"
  python3 - "$root" "$PI_RUN_SPEC" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
rel = sys.argv[2] if len(sys.argv) > 2 else "specs/test_login.py"
path = root / "tests" / rel
if not path.is_file():
    specs = sorted((root / "tests/specs").glob("*.py"))
    if not specs:
        raise SystemExit("No spec files under tests/specs/")
    path = specs[0]
text = path.read_text()
broken_line = 'expect(page.locator("#pi-demo-broken")).to_be_visible()'
if broken_line in text:
    print(f"{path.name} already broken")
    sys.exit(0)
updated, n = re.subn(
    r"^(\s*)expect\([^\n]+\)\s*$",
    rf"\1{broken_line}",
    text,
    count=1,
    flags=re.M,
)
if n:
    path.write_text(updated)
    print(f"Broke {path.name} (replaced first expect line)")
    sys.exit(0)
m = re.search(r"(def test_\w+\([^)]*\):\s*\n)(\s+)", text)
if not m:
    raise SystemExit(f"Cannot find test function in {path}")
indent = m.group(2)
insert = f'{indent}assert False, "pi-demo-break"\n'
path.write_text(text[: m.end()] + insert + text[m.end() :])
print(f"Broke {path.name} via assert False")
PY
}

require_pi_key

echo "==> Pi Wave preflight (SEED_TESTS=never, workspace=$WORKSPACE_NAME)"
curl -sf "$BASE/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok")'

if [ -n "${PI_WAVE_RESUME_PID:-}" ]; then
  PID="$PI_WAVE_RESUME_PID"
  WORKSPACE_NAME="${PI_WAVE_RESUME_WORKSPACE:?PI_WAVE_RESUME_WORKSPACE required}"
  V1_ID="${PI_WAVE_RESUME_V1_ID:?PI_WAVE_RESUME_V1_ID required}"
  PLAN_JSON=$(curl -sf "$BASE/api/projects/$PID/plan?moduleName=saucedemo")
  PI_WAVE_FROM_STEP="${PI_WAVE_FROM_STEP:-4}"
  if [ "$PI_WAVE_FROM_STEP" = "7" ]; then
    echo "==> Resume Pi Wave from step 7 (project=$PID v1=$V1_ID)"
    goto_step4=2
  else
    echo "==> Resume Pi Wave from step 4 (project=$PID workspace=$WORKSPACE_NAME)"
    curl -sf "$BASE/api/projects/$PID/files" | python3 -c '
import json,sys
files=json.load(sys.stdin)["data"]["files"]
specs=[f for f in files if f.get("path","").startswith("specs/") and f["path"].endswith(".py")]
assert specs, f"no spec files: {files[:5]}"
print("resume code OK specs=%s" % len(specs))
'
    goto_step4=1
  fi
else
  goto_step4=0
fi

if [ "$goto_step4" -eq 0 ]; then
echo "==> 1. Create project + init + upload recorded"
PID=$(curl -sf -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"PiDemo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
echo "Project ID: $PID"

curl -sf -X POST "$BASE/api/projects/$PID/init-template" >/dev/null
RECORDED="$REFERENCE_TESTS/recorded/saucedemo.py"
curl -sf -X POST "$BASE/api/projects/$PID/record/upload" \
  -F "file=@$RECORDED" \
  -F "moduleName=saucedemo" >/dev/null

echo "==> 2. Pi plan/generate (MVP #5)"
PLAN_JOB=$(curl -sf -X POST "$BASE/api/projects/$PID/plan/generate" \
  -H 'Content-Type: application/json' \
  -d '{"moduleName":"saucedemo"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
echo "Plan job: $PLAN_JOB"
poll_job "$PLAN_JOB" "plan"

PLAN_JSON=$(curl -sf "$BASE/api/projects/$PID/plan?moduleName=saucedemo")
echo "$PLAN_JSON" | python3 -c '
import json,sys,re
d=json.load(sys.stdin)["data"]
content=d.get("content") or ""
assert len(content.strip())>50, "plan content too short"
assert re.search(r"(?:TC[-_]?\d+|test_tc\d+)", content, re.I), "plan missing TC identifiers"
vid=d.get("planVersionId")
assert vid, "missing planVersionId after Pi plan/generate"
print(f"plan OK len={len(content)} planVersionId={vid}")
'

V1_ID=$(echo "$PLAN_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d.get("planVersionId") or "")')

echo "==> 3. Pi code/generate confirmPlan (MVP #6)"
CODE_JOB=$(curl -sf -X POST "$BASE/api/projects/$PID/code/generate" \
  -H 'Content-Type: application/json' \
  -d '{"moduleName":"saucedemo","confirmPlan":true}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
echo "Code job: $CODE_JOB"
poll_job "$CODE_JOB" "code"

curl -sf "$BASE/api/projects/$PID/files" | python3 -c '
import json,sys
files=json.load(sys.stdin)["data"]["files"]
specs=[f for f in files if f.get("path","").startswith("specs/") and f["path"].endswith(".py")]
assert specs, f"no spec files: {files[:5]}"
print("code OK specs=%s sample=%s" % (len(specs), specs[0]["path"]))
'
fi

if [ "$goto_step4" -ne 2 ]; then
echo "==> 4. CI run baseline (before intentional break)"
BASE_RUN=$(start_ci_run "$PID")
BASE_JSON=$(poll_run "$PID" "$BASE_RUN")
echo "$BASE_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("baseline status=%s passed=%s failed=%s" % (d["status"], d["passed"], d["failed"]))
assert d["passed"]+d["failed"]>=1, "expected at least one test executed"
'

echo "==> 5. Break first spec + failed run + Pi fix/analyze (MVP #9 / Phase2 #3)"
break_first_spec
FAIL_RUN=$(start_ci_run "$PID")
FAIL_JSON=$(poll_run "$PID" "$FAIL_RUN")
echo "$FAIL_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
assert d["failed"]>=1 or d["status"]=="failed", d
print("failed run status=%s failed=%s" % (d["status"], d["failed"]))
'

FIX_JOB=$(curl -sf -X POST "$BASE/api/projects/$PID/fix/analyze" \
  -H 'Content-Type: application/json' \
  -d "{\"runId\":\"$FAIL_RUN\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
echo "Fix job: $FIX_JOB"
poll_job "$FIX_JOB" "fix"

FIX=$(curl -sf "$BASE/api/projects/$PID/runs/$FAIL_RUN/fix")
echo "$FIX" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
analysis=d.get("analysis") or ""
patches=d.get("patches") or []
assert len(analysis.strip())>20, "fix analysis too short"
if not patches:
    raise SystemExit("Pi fix/analyze returned no patches — Phase2 #3 not satisfied")
for p in patches:
    assert p.get("file") and "@@" in p.get("unifiedDiff",""), p
print("fix OK analysis_len=%s patches=%s" % (len(analysis), len(patches)))
'
SUGGESTION_ID=$(echo "$FIX" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["suggestionId"])')

echo "==> 6. fix/apply patch[0] + autoVerify"
APPLY=$(curl -sf -X POST "$BASE/api/projects/$PID/fix/apply" \
  -H 'Content-Type: application/json' \
  -d "{\"suggestionId\":\"$SUGGESTION_ID\",\"patchIndexes\":[0],\"autoVerify\":true}")
VERIFY_RUN=$(echo "$APPLY" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; assert d.get("verifyRunId"); print(d["verifyRunId"])')
VERIFY_JSON=$(poll_run "$PID" "$VERIFY_RUN" 90)
echo "$VERIFY_JSON" | python3 -c '
import json,sys
d=json.load(sys.stdin)["data"]
print("verify status=%s passed=%s failed=%s" % (d["status"], d["passed"], d["failed"]))
'
fi

echo "==> 7. Plan v2 + Pi code/generate(planVersionId) (Phase2 #2)"
if [ -n "${PI_WAVE_V2_ID:-}" ]; then
  V2_ID="$PI_WAVE_V2_ID"
  echo "Reuse plan v2 id: $V2_ID"
else
  V2_PAYLOAD=$(echo "$PLAN_JSON" | V1_ID="$V1_ID" python3 -c '
import json, os, sys
plan = json.load(sys.stdin)["data"]
print(json.dumps({
    "content": plan["content"].rstrip() + "\n\n## TC-016 Pi Wave extra\n",
    "moduleName": "saucedemo",
    "baseVersionId": os.environ["V1_ID"],
    "message": "pi wave v2",
}))
')
  V2=$(curl -sf -X PUT "$BASE/api/projects/$PID/plan" \
    -H 'Content-Type: application/json' \
    -d "$V2_PAYLOAD")
  V2_ID=$(echo "$V2" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["id"])')
  echo "Plan v2 id: $V2_ID"
fi

CODE2_JOB=$(curl -sf -X POST "$BASE/api/projects/$PID/code/generate" \
  -H 'Content-Type: application/json' \
  -d "{\"moduleName\":\"saucedemo\",\"confirmPlan\":true,\"planVersionId\":\"$V2_ID\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["jobId"])')
echo "Code v2 job: $CODE2_JOB"
poll_job "$CODE2_JOB" "code-v2"

curl -sf "$BASE/api/projects/$PID/plan/diff?v1=$V1_ID&v2=$V2_ID" | python3 -c '
import json,sys
diff=json.load(sys.stdin)["data"]["diff"]
assert "TC-016" in diff, diff
print("plan diff v1->v2 OK")
'

if [ "$goto_step4" -eq 2 ]; then
  echo "Pi Wave step 7 complete. Project=$PID v2=$V2_ID"
elif [ "$goto_step4" -eq 1 ]; then
  echo "Pi Wave resume complete. Project=$PID failRun=$FAIL_RUN verifyRun=$VERIFY_RUN v2=$V2_ID"
else
  echo "Pi Wave complete. Project=$PID baselineRun=$BASE_RUN failRun=$FAIL_RUN verifyRun=$VERIFY_RUN v2=$V2_ID"
fi
