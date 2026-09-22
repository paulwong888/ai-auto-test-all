#!/bin/sh
set -eu

TARGET_URL="${TARGET_URL:?TARGET_URL required}"
MODULE_NAME="${MODULE_NAME:-saucedemo}"
OUTPUT_PATH="${OUTPUT_PATH:-/workspace/tests/recorded/${MODULE_NAME}.py}"
IGNORE_HTTPS_ERRORS="${IGNORE_HTTPS_ERRORS:-1}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
fluxbox &
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc 6080 localhost:5900 &

HTTPS_FLAG=""
if [ "$IGNORE_HTTPS_ERRORS" != "0" ]; then
  HTTPS_FLAG="--ignore-https-errors"
fi

/opt/venv/bin/playwright codegen "$TARGET_URL" --target python-pytest -o "$OUTPUT_PATH" $HTTPS_FLAG &
CODEGEN_PID=$!

trap 'kill $CODEGEN_PID 2>/dev/null || true; exit 0' TERM INT

wait $CODEGEN_PID || echo "[recorder] playwright codegen exited (see logs above); VNC stays open until stop" >&2

# Keep noVNC alive until API stop/kill — codegen may exit early on cert/network errors.
while kill -0 $CODEGEN_PID 2>/dev/null; do
  wait $CODEGEN_PID || true
done
while true; do
  sleep 3600
done
