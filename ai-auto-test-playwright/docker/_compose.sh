#!/usr/bin/env bash
# Shared helpers for docker/*.sh — source from sibling scripts, do not execute directly.

set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DOCKER_DIR"

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

ensure_env_files() {
  if [ ! -f .env ]; then
    if [ -f .env.example ]; then
      echo "==> Creating .env from .env.example"
      cp .env.example .env
    else
      echo "Missing docker/.env (copy from .env.example)" >&2
      exit 1
    fi
  fi
  if [ ! -f .env.local ] && [ -f .env.local.example ]; then
    echo "Hint: copy .env.local.example → .env.local and set DASHSCOPE_API_KEY for Pi jobs." >&2
  fi
}

print_urls() {
  # shellcheck disable=SC1091
  set +u
  # shellcheck source=/dev/null
  [ -f .env ] && . ./.env
  set -u
  local dash_port="${DASHBOARD_PORT:-8040}"
  local api_port="${SERVER_PORT:-3001}"
  echo ""
  echo "Dashboard:  http://localhost:${dash_port}"
  echo "API:        http://localhost:${api_port}"
  echo "Health:     http://localhost:${dash_port}/health"
}
