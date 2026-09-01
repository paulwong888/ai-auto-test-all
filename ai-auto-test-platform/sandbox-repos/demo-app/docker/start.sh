#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f .env ]] || { cp .env.example .env; echo "请先编辑 .env"; exit 1; }
# shellcheck disable=SC1091
source .env
docker compose --env-file .env up -d
echo "[start] http://localhost:${PORT}  （测试账号 admin / 123456）"
