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

STATE_DIR="${DEST}/.state"
HKID_USED_BACKUP=""
SIM_USED_BACKUP=""
if HKID_USED_BACKUP="$(docker exec "$CONTAINER" cat "${STATE_DIR}/hkid_used.json" 2>/dev/null)"; then
  :
fi
if SIM_USED_BACKUP="$(docker exec "$CONTAINER" cat "${STATE_DIR}/sim_used.json" 2>/dev/null)"; then
  :
fi

docker cp "${SRC}/." "${CONTAINER}:${DEST}/"

# docker cp 不会删除 Worker 上已移除的文件；显式清理已下线的 spec
if [[ ! -f "${SRC}/specs/test_sales_portal.py" ]]; then
  docker exec "$CONTAINER" rm -f "${DEST}/specs/test_sales_portal.py"
fi

if [[ -n "${HKID_USED_BACKUP}" ]]; then
  echo "${HKID_USED_BACKUP}" | docker exec -i "$CONTAINER" tee "${STATE_DIR}/hkid_used.json" >/dev/null
fi
if [[ -n "${SIM_USED_BACKUP}" ]]; then
  echo "${SIM_USED_BACKUP}" | docker exec -i "$CONTAINER" tee "${STATE_DIR}/sim_used.json" >/dev/null
fi

echo "Synced ${SRC} -> ${CONTAINER}:${DEST} (preserved .state/hkid_used.json + sim_used.json)"
