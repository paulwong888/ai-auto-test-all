#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

# shellcheck source=lib.sh
source "${ROOT}/lib.sh"
compose_cmd

load_env_files
load_runtime_env

if [[ -n "${COMPOSE_PROFILES:-}" ]]; then
  export COMPOSE_PROFILES
else
  export COMPOSE_PROFILES="$(compose_profiles_for_down)"
fi

if (($# > 0)); then
  "${COMPOSE[@]}" logs -f "$@"
else
  "${COMPOSE[@]}" logs -f
fi
