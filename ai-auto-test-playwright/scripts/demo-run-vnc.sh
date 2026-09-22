#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
DASHBOARD="${DASHBOARD:-http://localhost:8040}"
SEED_TESTS="${SEED_TESTS:-auto}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REFERENCE_TESTS="$REPO_ROOT/tests"
WORKSPACE_NAME="run-vnc-demo-$$"

echo "==> Health"
curl -sf "$BASE/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok"), d'

if [ -n "${PROJECT_ID:-}" ]; then
  PROJECT="$PROJECT_ID"
  echo "==> Using PROJECT_ID=$PROJECT"
else
  echo "==> Create project"
  PROJECT=$(curl -sf -X POST "$BASE/api/projects" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"RunVncDemo\",\"baseUrl\":\"https://www.saucedemo.com\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
  echo "Project ID: $PROJECT"
  curl -sf -X POST "$BASE/api/projects/$PROJECT/init-template" >/dev/null
fi

seed_needed=false
if [ "$SEED_TESTS" = "always" ]; then
  seed_needed=true
elif [ "$SEED_TESTS" = "auto" ]; then
  if ! curl -sf "$BASE/api/projects/$PROJECT/files" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; exit(0 if any("specs/" in f.get("path","") for f in d.get("files",[])) else 1)'; then
    seed_needed=true
  fi
fi

if [ "$seed_needed" = true ] && [ -d "$REFERENCE_TESTS" ]; then
  echo "==> Seed reference tests/"
  docker exec ai-auto-test-playwright-server sh -c "rm -rf /data/projects/$WORKSPACE_NAME/tests/specs /data/projects/$WORKSPACE_NAME/tests/pages 2>/dev/null; true" 2>/dev/null || true
  for sub in specs pages data recorded plans; do
    if [ -d "$REFERENCE_TESTS/$sub" ]; then
      docker cp "$REFERENCE_TESTS/$sub" "ai-auto-test-playwright-server:/data/projects/$WORKSPACE_NAME/tests/" 2>/dev/null || \
        echo "Skip docker cp $sub (set PROJECT_ID to existing project with specs)" >&2
    fi
  done
fi

echo "==> POST run preset=debug (vncPreview implicit)"
RUN_JSON=$(curl -sf -X POST "$BASE/api/projects/$PROJECT/run" \
  -H 'Content-Type: application/json' \
  -d '{"preset":"debug"}')
echo "$RUN_JSON" | python3 -m json.tool

RUN_ID=$(echo "$RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["runId"])')
VNC_URL=$(echo "$RUN_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin)["data"]; print(d.get("vncUrl") or "")')

if [ -z "$VNC_URL" ]; then
  echo "FAIL: debug run did not return vncUrl" >&2
  exit 1
fi

echo "==> GET vnc.html (API)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE${VNC_URL}/vnc.html" || echo "000")
echo "vnc.html HTTP $CODE (via $BASE)"
if [ "$CODE" != "200" ]; then
  echo "FAIL: expected 200 from run VNC proxy" >&2
  exit 1
fi

echo "==> GET vnc.html (Dashboard reverse proxy)"
CODE2=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD${VNC_URL}/vnc.html" || echo "000")
echo "vnc.html HTTP $CODE2 (via $DASHBOARD)"
if [ "$CODE2" != "200" ]; then
  echo "WARN: dashboard proxy returned $CODE2 (API path OK)" >&2
fi

echo "==> Wait for run to finish (max 10 min)"
for _ in $(seq 1 120); do
  ST=$(curl -sf "$BASE/api/projects/$PROJECT/runs/$RUN_ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["status"])')
  echo "  status=$ST"
  if [ "$ST" != "running" ]; then
    break
  fi
  sleep 5
done

echo "==> VNC after run (expect unavailable)"
CODE3=$(curl -s -o /dev/null -w "%{http_code}" "$BASE${VNC_URL}/vnc.html" || echo "000")
echo "vnc.html HTTP $CODE3 after completion"
if [ "$CODE3" = "200" ]; then
  echo "WARN: VNC still 200 after run ended" >&2
fi

echo "Run VNC demo OK: project=$PROJECT run=$RUN_ID"
