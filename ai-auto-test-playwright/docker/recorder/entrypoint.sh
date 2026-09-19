#!/bin/sh
set -eu

TARGET_URL="${TARGET_URL:?TARGET_URL required}"
MODULE_NAME="${MODULE_NAME:-saucedemo}"
OUTPUT_PATH="${OUTPUT_PATH:-/workspace/tests/recorded/${MODULE_NAME}.py}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
fluxbox &
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc 6080 localhost:5900 &

/opt/venv/bin/playwright codegen "$TARGET_URL" --target python-pytest -o "$OUTPUT_PATH" &
CODEGEN_PID=$!

trap 'kill $CODEGEN_PID 2>/dev/null || true; exit 0' TERM INT

wait $CODEGEN_PID || true
