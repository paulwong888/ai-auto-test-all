#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:3001}"

echo "==> 1. Health + queue infra"
curl -sf "$BASE/health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d.get("ok")'

echo "==> 2. Auth register/login (skip if AUTH_DISABLED)"
curl -sf -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo-'$$'@example.com","password":"demo1234","displayName":"Demo"}' \
  >/dev/null 2>&1 || echo "Auth skipped or user exists"

echo "==> 3. MVP demo regression"
MODE=ci SEED_TESTS=always "$BASE/../scripts/demo-saucedemo.sh" 2>/dev/null || \
  MODE=ci SEED_TESTS=always "$(dirname "$0")/demo-saucedemo.sh"

echo "==> 4. Phase 2 regression"
"$(dirname "$0")/demo-phase2.sh"

echo "==> 5. Git + CI webhook (SSH, optional)"
"$(dirname "$0")/demo-git-ci.sh"

echo "==> 6. Wave 2 recording regression"
"$(dirname "$0")/demo-recording.sh"

echo "Phase 3 demo complete."

# Optional RBAC (requires auth compose override):
# docker-compose -f docker-compose.yml -f docker-compose.auth.yml up -d server
# ./scripts/demo-rbac.sh
