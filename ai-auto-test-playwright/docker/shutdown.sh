#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

# shellcheck source=lib.sh
source "${ROOT}/lib.sh"
compose_cmd

load_env_files

# Include bundled profiles so postgres/redis containers are stopped when present.
export COMPOSE_PROFILES="$(compose_profiles_for_down)"
"${COMPOSE[@]}" down --remove-orphans
