#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
service="${1:-}"
if [[ -z "$service" ]]; then
  docker compose logs -f --tail=100
else
  docker compose logs -f --tail=100 "$service"
fi
