#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3002}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REFERENCE_TESTS="$(cd "$SCRIPT_DIR/../.." && pwd)/tests"
WORKSPACE_NAME="rbac-demo-$$"
HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ai-auto-test-playwright-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ai_auto_test_playwright}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
SUFFIX="$$"

register_user() {
  local role="$1"
  local email="${role}-${SUFFIX}@example.com"
  local password="demo1234"
  curl -sf -X POST "$BASE/api/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\",\"displayName\":\"$role\"}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d["token"])'
}

auth_status() {
  curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects"
}

echo "==> RBAC demo (requires AUTH_DISABLED=false)"
HTTP=$(auth_status)
if [ "$HTTP" != "401" ]; then
  echo "WARN: Expected GET /api/projects without token → 401, got $HTTP" >&2
  echo "Start server with: docker-compose -f docker-compose.yml -f docker-compose.auth.yml up -d server" >&2
  exit 0
fi

echo "==> 1. Register owner / editor / viewer"
OWNER_TOKEN=$(register_user owner)
EDITOR_TOKEN=$(register_user editor)
VIEWER_TOKEN=$(register_user viewer)
EDITOR_EMAIL="editor-${SUFFIX}@example.com"
VIEWER_EMAIL="viewer-${SUFFIX}@example.com"

echo "==> 2. Owner creates project"
PID=$(curl -sf -X POST "$BASE/api/projects" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"RBAC Demo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
echo "Project ID: $PID"

OWNER_ID=$(docker exec -i "$POSTGRES_CONTAINER" psql -q -t -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "SELECT user_id FROM project_members WHERE project_id='$PID' AND role='owner';" | tr -d '[:space:]')
if [ -z "$OWNER_ID" ]; then
  echo "Expected owner in project_members" >&2
  exit 1
fi

echo "==> 3. Owner invites editor + viewer"
curl -sf -X POST "$BASE/api/projects/$PID/members" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EDITOR_EMAIL\",\"role\":\"editor\"}" >/dev/null
curl -sf -X POST "$BASE/api/projects/$PID/members" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$VIEWER_EMAIL\",\"role\":\"viewer\"}" >/dev/null

echo "==> 4. Seed workspace for run"
curl -sf -X POST "$BASE/api/projects/$PID/init-template" \
  -H "Authorization: Bearer $EDITOR_TOKEN" >/dev/null
mkdir -p "$HOST_PATH/$WORKSPACE_NAME/tests"
rsync -a --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' \
  --exclude 'test-results' --exclude '.runs' --exclude 'report.html' \
  "$REFERENCE_TESTS/" "$HOST_PATH/$WORKSPACE_NAME/tests/"

echo "==> 5. Viewer POST /run → 403"
VIEWER_RUN_HTTP=$(curl -s -o /tmp/rbac-viewer-run.json -w '%{http_code}' -X POST "$BASE/api/projects/$PID/run" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"preset":"ci"}')
if [ "$VIEWER_RUN_HTTP" != "403" ]; then
  echo "Expected 403 for viewer run, got $VIEWER_RUN_HTTP" >&2
  cat /tmp/rbac-viewer-run.json >&2 || true
  exit 1
fi

echo "==> 6. Editor POST /run → 202"
EDITOR_RUN_HTTP=$(curl -s -o /tmp/rbac-editor-run.json -w '%{http_code}' -X POST "$BASE/api/projects/$PID/run" \
  -H "Authorization: Bearer $EDITOR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"preset":"ci"}')
if [ "$EDITOR_RUN_HTTP" != "202" ]; then
  echo "Expected 202 for editor run, got $EDITOR_RUN_HTTP" >&2
  cat /tmp/rbac-editor-run.json >&2 || true
  exit 1
fi
RUN_ID=$(python3 -c 'import json; print(json.load(open("/tmp/rbac-editor-run.json"))["data"]["runId"])')

echo "==> 7. Viewer POST /git/push → 403"
VIEWER_PUSH_HTTP=$(curl -s -o /tmp/rbac-viewer-push.json -w '%{http_code}' -X POST "$BASE/api/projects/$PID/git/push" \
  -H "Authorization: Bearer $VIEWER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"message":"rbac test"}')
if [ "$VIEWER_PUSH_HTTP" != "403" ]; then
  echo "Expected 403 for viewer git push, got $VIEWER_PUSH_HTTP" >&2
  exit 1
fi

echo "==> 8. Owner GET /audit contains run.start + member.invite"
AUDIT_JSON=$(curl -sf "$BASE/api/projects/$PID/audit" -H "Authorization: Bearer $OWNER_TOKEN")
echo "$AUDIT_JSON" | python3 -c '
import json, sys
logs = json.load(sys.stdin)["data"]["logs"]
actions = {row["action"] for row in logs}
required = {"run.start", "member.invite"}
missing = required - actions
if missing:
    raise SystemExit(f"missing audit actions: {missing}")
print("audit ok:", sorted(actions))
'

echo "==> 9. Unauthenticated GET /projects → 401"
HTTP=$(auth_status)
if [ "$HTTP" != "401" ]; then
  echo "Expected 401 without token, got $HTTP" >&2
  exit 1
fi

echo "RBAC demo complete (project=$PID, run=$RUN_ID)."
