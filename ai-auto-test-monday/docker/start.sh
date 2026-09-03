#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f .env ]]; then cp .env.example .env; echo "[start] 已创建 .env，请确认 Postgres 库 ai_auto_test_monday 已存在"; fi
mkdir -p data/artifacts data/repos
docker compose --env-file .env up -d --build
echo "[start] Dashboard http://localhost:${DASHBOARD_PORT:-8040}"
echo "[start] API       http://localhost:${API_PORT:-3010}/health"
echo "[start] Temporal  http://localhost:${TEMPORAL_UI_PORT:-8088}"
