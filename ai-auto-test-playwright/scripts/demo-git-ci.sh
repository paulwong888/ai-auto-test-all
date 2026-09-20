#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GIT_REPO_URL="${GIT_REPO_URL:-git@github.com:paulwong888/ai-auto-test-all.git}"
GIT_DEFAULT_BRANCH="${GIT_DEFAULT_BRANCH:-main}"
WORKSPACE_NAME="e2e-git-demo-$$"
HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ai-auto-test-playwright-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_auto_test_playwright}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

poll_run() {
  local pid="$1"
  local run_id="$2"
  local auth_header="${3:-}"
  local max="${4:-120}"
  local curl_auth=()
  if [ -n "$auth_header" ]; then
    curl_auth=(-H "Authorization: Bearer $auth_header")
  fi
  local json=""
  for _ in $(seq 1 "$max"); do
    json=$(curl -sf "${curl_auth[@]}" "$BASE/api/projects/$pid/runs/$run_id")
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

SSH_CHECK=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)
if ! echo "$SSH_CHECK" | grep -qiE 'successfully authenticated|Hi '; then
  echo "WARN: GitHub SSH not available — skipping demo-git-ci.sh (configure ~/.ssh and compose SSH_DIR mount)" >&2
  echo "$SSH_CHECK" >&2
  exit 0
fi

echo "==> Git + CI demo (repo=$GIT_REPO_URL)"

echo "==> 1. Create project"
PID=$(curl -sf -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Git CIDemo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
echo "Project ID: $PID"

echo "==> 2. Bind Git (SSH)"
curl -sf -X PUT "$BASE/api/projects/$PID/git" \
  -H 'Content-Type: application/json' \
  -d "{\"repoUrl\":\"$GIT_REPO_URL\",\"token\":\"\",\"defaultBranch\":\"$GIT_DEFAULT_BRANCH\"}" \
  | python3 -c 'import json,sys; assert json.load(sys.stdin)["data"]["bound"] is True'

echo "==> 3. Git sync (clone)"
curl -sf -X POST "$BASE/api/projects/$PID/git/sync" \
  | python3 -c 'import json,sys; assert json.load(sys.stdin)["data"]["synced"] is True'

echo "==> 4. Stage tests/ change for push"
MARKER="$HOST_PATH/$WORKSPACE_NAME/tests/.e2e-wave3-demo"
mkdir -p "$(dirname "$MARKER")"
echo "wave3-demo-$$ $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$MARKER"

echo "==> 5. Git push (new e2e/* branch)"
PUSH_JSON=$(curl -sf -X POST "$BASE/api/projects/$PID/git/push" \
  -H 'Content-Type: application/json' \
  -d '{"message":"chore(e2e): wave3 demo marker"}')
BRANCH=$(echo "$PUSH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["branch"])')
echo "Pushed branch: $BRANCH"

echo "==> 6. Verify remote branch"
git ls-remote "$GIT_REPO_URL" "refs/heads/$BRANCH" | grep -q "refs/heads/$BRANCH"

echo "==> 7. Create run-scoped API token"
TOKEN_JSON=$(curl -sf -X POST "$BASE/api/projects/$PID/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Wave3 CI","scopes":["run"]}')
API_TOKEN=$(echo "$TOKEN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["token"])')

echo "==> 8. Webhook CI run"
HOOK_JSON=$(curl -sf -X POST "$BASE/api/webhooks/ci/run" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"$PID\",\"preset\":\"ci\"}")
RUN_ID=$(echo "$HOOK_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])')
echo "Webhook run ID: $RUN_ID"

echo "==> 9. Poll run until finished"
FINAL_JSON=$(poll_run "$PID" "$RUN_ID" "$API_TOKEN")
STATUS=$(echo "$FINAL_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
if [ "$STATUS" != "passed" ]; then
  echo "Expected passed run, got $STATUS" >&2
  exit 1
fi

echo "==> 10. Run-only token cannot DELETE project"
HTTP=$(curl -s -o /tmp/wave3-delete.json -w '%{http_code}' -X DELETE "$BASE/api/projects/$PID" \
  -H "Authorization: Bearer $API_TOKEN")
if [ "$HTTP" != "403" ]; then
  echo "Expected 403 on DELETE with run token, got $HTTP" >&2
  cat /tmp/wave3-delete.json >&2 || true
  exit 1
fi

echo "==> 11. trigger_source=ci"
TRIGGER=$(docker exec -i "$POSTGRES_CONTAINER" psql -q -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "SELECT trigger_source FROM runs WHERE id='$RUN_ID';" | tr -d '[:space:]')
if [ "$TRIGGER" != "ci" ]; then
  echo "Expected trigger_source=ci, got '$TRIGGER'" >&2
  exit 1
fi

echo "Git + CI demo complete (branch=$BRANCH, run=$RUN_ID)."
