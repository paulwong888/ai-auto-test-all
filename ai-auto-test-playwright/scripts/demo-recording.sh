#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3002}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_NAME="recording-demo-$$"
HOST_PATH="${PROJECTS_DATA_HOST_PATH:-$SCRIPT_DIR/../docker/data/projects}"
MODULE_NAME="${MODULE_NAME:-saucedemo}"
TARGET_URL="${TARGET_URL:-https://www.saucedemo.com}"
WAIT_SEC="${WAIT_SEC:-10}"

echo "==> 1. Create project ($BASE)"
PID=$(curl -sf -X POST "$BASE/api/projects" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"Recording Demo\",\"baseUrl\":\"$TARGET_URL\",\"workspacePath\":\"/data/projects/$WORKSPACE_NAME\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])')
echo "Project ID: $PID"

echo "==> 2. Init template"
curl -sf -X POST "$BASE/api/projects/$PID/init-template" >/dev/null

echo "==> 3. Start web recording"
START_JSON=$(curl -sf -X POST "$BASE/api/projects/$PID/record/start" \
  -H 'Content-Type: application/json' \
  -d "{\"moduleName\":\"$MODULE_NAME\",\"targetUrl\":\"$TARGET_URL\"}")
SESSION_ID=$(echo "$START_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["sessionId"])')
VNC_URL=$(echo "$START_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["vncUrl"])')
echo "Session ID: $SESSION_ID"
echo "VNC URL: $VNC_URL"

echo "==> 4. Probe VNC proxy (retry until recorder ready)"
VNC_OK=0
for _ in $(seq 1 12); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$VNC_URL/vnc.html" || echo "000")
  if [ "$CODE" = "200" ]; then
    VNC_OK=1
    echo "vnc.html HTTP $CODE"
    break
  fi
  sleep 2
done
if [ "$VNC_OK" -ne 1 ]; then
  echo "VNC proxy did not become ready (last HTTP $CODE)" >&2
  exit 1
fi

echo "==> 5. Wait ${WAIT_SEC}s (simulated interaction window)"
sleep "$WAIT_SEC"

echo "==> 6. Stop recording"
curl -sf -X POST "$BASE/api/projects/$PID/record/stop" \
  -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\"}" >/dev/null

OUTPUT_FILE="$HOST_PATH/$WORKSPACE_NAME/tests/recorded/${MODULE_NAME}.py"
echo "==> 7. Verify output: $OUTPUT_FILE"
if [ ! -f "$OUTPUT_FILE" ]; then
  echo "Missing recorded file: $OUTPUT_FILE" >&2
  exit 1
fi
echo "OK: $(wc -c < "$OUTPUT_FILE") bytes written"
echo "Wave 2 recording smoke test passed."
