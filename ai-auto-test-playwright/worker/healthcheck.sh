#!/bin/sh
set -eu
PORT="${PORT:-8081}"
python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PORT}/health', timeout=3)"
