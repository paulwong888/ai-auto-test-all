#!/usr/bin/env bash
# Follow logs. Examples:
#   ./logs.sh              # all services
#   ./logs.sh server worker
#   TAIL=500 ./logs.sh server
set -euo pipefail
# shellcheck source=_compose.sh
source "$(dirname "$0")/_compose.sh"

TAIL="${TAIL:-200}"
if [ "$#" -eq 0 ]; then
  compose logs -f --tail="$TAIL"
else
  compose logs -f --tail="$TAIL" "$@"
fi
