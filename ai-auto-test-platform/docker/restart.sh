#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "[restart] 缺少 .env，请先运行 ./build.sh 或 ./start.sh"
  exit 1
fi

echo "[restart] 重启服务..."
docker compose --env-file .env down
docker compose --env-file .env up -d

echo "[restart] 完成"
