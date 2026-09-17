#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "[rebuild-restart] 缺少 .env，请先运行 ./start.sh"
  exit 1
fi

WORKER_SCALE="${WORKER_SCALE:-3}"
# shellcheck disable=SC1091
set -a && source .env && set +a
WORKER_SCALE="${WORKER_SCALE:-3}"

scale_worker_args=()
should_scale_worker=false
if [[ $# -eq 0 ]]; then
  should_scale_worker=true
else
  for svc in "$@"; do
    if [[ "$svc" == "worker" ]]; then
      should_scale_worker=true
      break
    fi
  done
fi
if [[ "$should_scale_worker" == true ]]; then
  scale_worker_args=(--scale "worker=${WORKER_SCALE}")
fi

if [[ $# -gt 0 ]]; then
  echo "[rebuild-restart] 构建并重新部署: $* (worker scale=${WORKER_SCALE})"
  docker compose --env-file .env up -d --build --force-recreate "${scale_worker_args[@]}" "$@"
else
  echo "[rebuild-restart] 构建并重新部署全部服务... (worker scale=${WORKER_SCALE})"
  docker compose --env-file .env up -d --build --force-recreate "${scale_worker_args[@]}"
fi

echo "[rebuild-restart] Dashboard http://localhost:${DASHBOARD_PORT:-8040}"
echo "[rebuild-restart] API       http://localhost:${API_PORT:-3010}/health"
echo "[rebuild-restart] Workers   scale=${WORKER_SCALE}"
echo "[rebuild-restart] 完成"
