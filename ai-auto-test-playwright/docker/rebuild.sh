#!/usr/bin/env bash
# Rebuild images and start. Optional: ./rebuild.sh [service...]
set -euo pipefail
# shellcheck source=_compose.sh
source "$(dirname "$0")/_compose.sh"

ensure_env_files
echo "==> docker compose up -d --build $*"
compose up -d --build "$@"
compose ps
print_urls
