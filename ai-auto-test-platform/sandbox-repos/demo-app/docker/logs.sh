#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
docker compose --env-file .env logs -f --tail=200 "${1:-}"
