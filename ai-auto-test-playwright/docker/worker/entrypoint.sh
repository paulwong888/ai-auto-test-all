#!/bin/sh
set -eu

# 720px 虚拟屏会把 Chromium 窗口底部（含 Sales Portal 底部购物车金额条）裁出 noVNC 画面
DISPLAY_WIDTH="${WORKER_DISPLAY_WIDTH:-1280}"
DISPLAY_HEIGHT="${WORKER_DISPLAY_HEIGHT:-900}"

# docker restart 后旧 X11 socket 可能残留，导致 Xvfb 启动失败而 pytest --headed 报 Missing DISPLAY
rm -f /tmp/.X11-unix/X99

Xvfb :99 -screen 0 "${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x24" &
export DISPLAY=:99
export WORKER_DISPLAY_WIDTH="${DISPLAY_WIDTH}"
export WORKER_DISPLAY_HEIGHT="${DISPLAY_HEIGHT}"
# 不用 fluxbox：任务栏会在浏览器下方留出一条黑边；Chromium 用与 Xvfb 等大的 window-size 贴边即可
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc 6080 localhost:5900 &

exec python /app/worker/server.py
