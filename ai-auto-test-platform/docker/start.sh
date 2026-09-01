#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[start] 已从 .env.example 创建 .env，请编辑后重新运行。"
  exit 1
fi

# shellcheck disable=SC1091
source .env

echo "[start] 启动服务..."
docker compose --env-file .env up -d

echo ""
echo "[start] 服务已启动"
echo "  Dashboard : http://localhost:${DASHBOARD_PORT}"
echo "  Backend   : http://localhost:${SERVER_PORT}"
echo ""
echo "  查看日志  : ./logs.sh"
echo "  停止服务  : ./shutdown.sh"
