#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
docker compose --env-file .env down 2>/dev/null || docker compose down
echo "[shutdown] 完成"
