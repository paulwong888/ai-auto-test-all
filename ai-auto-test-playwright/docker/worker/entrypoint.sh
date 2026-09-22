#!/bin/sh
set -eu

Xvfb :99 -screen 0 1280x720x24 &
export DISPLAY=:99
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw &
websockify --web /usr/share/novnc 6080 localhost:5900 &

exec python /app/worker/server.py
