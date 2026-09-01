#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f .env ]] || { cp .env.example .env; echo "已创建 .env"; exit 1; }
docker compose --env-file .env build
echo "[build] 完成"
