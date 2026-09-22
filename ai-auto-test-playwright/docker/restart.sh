#!/usr/bin/env bash
# Recreate containers (pick up env changes, no image rebuild).
# Optional: ./restart.sh [service...]
set -euo pipefail
# shellcheck source=_compose.sh
source "$(dirname "$0")/_compose.sh"

ensure_env_files
if [ "$#" -eq 0 ]; then
  echo "==> docker compose up -d --force-recreate"
  compose up -d --force-recreate
else
  echo "==> docker compose up -d --force-recreate $*"
  compose up -d --force-recreate "$@"
fi
compose ps
print_urls
