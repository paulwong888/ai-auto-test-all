#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "[build] 已从 .env.example 创建 .env，请编辑后重新运行。"
  exit 1
fi

echo "[build] 构建镜像..."
docker compose --env-file .env build

echo "[build] 完成"
