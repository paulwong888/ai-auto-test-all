#!/usr/bin/env bash
# Start stack (no image rebuild). Optional: ./start.sh [service...]
set -euo pipefail
# shellcheck source=_compose.sh
source "$(dirname "$0")/_compose.sh"

ensure_env_files
echo "==> docker compose up -d $*"
compose up -d "$@"
compose ps
print_urls
