#!/bin/sh
set -eu

TARGET_URL="${TARGET_URL:?TARGET_URL required}"
MODULE_NAME="${MODULE_NAME:-saucedemo}"
OUTPUT_PATH="${OUTPUT_PATH:-/workspace/tests/recorded/${MODULE_NAME}.py}"
IGNORE_HTTPS="${IGNORE_HTTPS_ERRORS:-1}"
# Codegen 底部有录制/代码面板；720px 虚拟屏会把页面底部固定条（如购物车蓝条）裁掉
DISPLAY_WIDTH="${RECORDER_DISPLAY_WIDTH:-1280}"
DISPLAY_HEIGHT="${RECORDER_DISPLAY_HEIGHT:-960}"
VIEWPORT_SIZE="${RECORDER_VIEWPORT_SIZE:-1280,720}"

mkdir -p "$(dirname "$OUTPUT_PATH")"

Xvfb :99 -screen 0 "${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x24" &
export DISPLAY=:99
fluxbox &
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc 6080 localhost:5900 &

CODEGEN_ARGS="--viewport-size=${VIEWPORT_SIZE}"
if [ "$IGNORE_HTTPS" = "1" ]; then
  CODEGEN_ARGS="$CODEGEN_ARGS --ignore-https-errors"
fi

/opt/venv/bin/playwright codegen "$TARGET_URL" --target python-pytest -o "$OUTPUT_PATH" $CODEGEN_ARGS &
CODEGEN_PID=$!

trap 'kill $CODEGEN_PID 2>/dev/null || true; exit 0' TERM INT

wait $CODEGEN_PID || true
echo "[recorder] codegen exited (pid $CODEGEN_PID); noVNC stays up until container stop"
while true; do sleep 86400; done
