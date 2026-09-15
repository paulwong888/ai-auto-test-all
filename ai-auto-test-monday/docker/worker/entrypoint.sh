#!/bin/bash
set -euo pipefail

PW_CLI="${PLAYWRIGHT_CLI_PATH:-/data/repos/sandbox/demo-app/node_modules/@playwright/test/cli.js}"
IMAGE_PW_VERSION="${PLAYWRIGHT_VERSION:-}"

if [ -f "$PW_CLI" ]; then
  REPO_PW_VERSION=$(node -p "require('$(dirname "$PW_CLI")/package.json').version" 2>/dev/null || echo "")
  # Deps + browser for IMAGE_PW_VERSION are baked into the image; only install
  # when the mounted repo uses a different Playwright version.
  if [ -n "$REPO_PW_VERSION" ] && [ "$REPO_PW_VERSION" != "$IMAGE_PW_VERSION" ]; then
    echo "[entrypoint] repo playwright $REPO_PW_VERSION != image $IMAGE_PW_VERSION, installing matching deps + browser"
    node "$PW_CLI" install-deps chromium 2>/dev/null || true
    node "$PW_CLI" install chromium
  fi
fi

exec "$@"
