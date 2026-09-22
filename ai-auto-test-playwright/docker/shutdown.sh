#!/usr/bin/env bash
# Stop and remove containers (keeps volumes / project data).
# Optional: ./shutdown.sh -v   # also remove named volumes (postgres data)
set -euo pipefail
# shellcheck source=_compose.sh
source "$(dirname "$0")/_compose.sh"

echo "==> docker compose down $*"
compose down "$@"
echo "Stack stopped."
