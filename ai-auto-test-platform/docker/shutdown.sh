#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "[shutdown] 缺少 .env，尝试直接停止 compose 项目..."
  docker compose down
  exit 0
fi

echo "[shutdown] 停止并移除容器..."
docker compose --env-file .env down

echo "[shutdown] 完成"
