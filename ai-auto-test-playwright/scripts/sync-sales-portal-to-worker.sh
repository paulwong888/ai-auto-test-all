#!/usr/bin/env bash
# Push reference-projects → worker live volume (/data/projects/sales-portal/tests).
# Run this after editing reference-projects; Dashboard Run uses the volume, not reference.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/reference-projects/sales-portal/tests"
CONTAINER="${SALES_PORTAL_WORKER_CONTAINER:-ai-auto-test-playwright-worker}"
DEST="/data/projects/sales-portal/tests"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  exit 1
fi

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "Container not running: $CONTAINER" >&2
  exit 1
fi

docker cp "${SRC}/." "${CONTAINER}:${DEST}/"
echo "Synced ${SRC} -> ${CONTAINER}:${DEST}"
