#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVICE="${1:-}"

if [[ ! -f .env ]]; then
  echo "[logs] 缺少 .env"
  exit 1
fi

if [[ -n "$SERVICE" ]]; then
  docker compose --env-file .env logs -f --tail=200 "$SERVICE"
else
  docker compose --env-file .env logs -f --tail=200
fi
