#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/docker/data/projects/sales-portal/tests"
DEST="${ROOT}/reference-projects/sales-portal/tests"

if [[ ! -d "$SRC" ]]; then
  echo "Source not found: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST"
(
  cd "$SRC"
  tar cf - \
    --exclude='fixtures/auth.json' \
    --exclude='.runs' \
    --exclude='report.html' \
    --exclude='.pytest_cache' \
    .
) | (
  cd "$DEST"
  tar xf -
)

echo "Synced $SRC -> $DEST"
