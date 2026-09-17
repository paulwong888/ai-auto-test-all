#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "[rebuild-restart] 缺少 .env，请先运行 ./start.sh"
  exit 1
fi

if [[ $# -gt 0 ]]; then
  echo "[rebuild-restart] 构建并重新部署: $*"
  docker compose --env-file .env up -d --build --force-recreate "$@"
else
  echo "[rebuild-restart] 构建并重新部署全部服务..."
  docker compose --env-file .env up -d --build --force-recreate
fi

echo "[rebuild-restart] Dashboard http://localhost:${DASHBOARD_PORT:-8040}"
echo "[rebuild-restart] API       http://localhost:${API_PORT:-3010}/health"
echo "[rebuild-restart] 完成"
