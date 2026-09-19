#!/bin/sh
set -eu

WORKSPACE_PATH="${1:?workspace path required}"
shift

TESTS_DIR="${WORKSPACE_PATH}/tests"
if [ ! -d "$TESTS_DIR" ]; then
  echo "tests directory not found: $TESTS_DIR" >&2
  exit 1
fi

cd "$TESTS_DIR"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/ms-playwright}"
exec /opt/venv/bin/pytest "$@"
