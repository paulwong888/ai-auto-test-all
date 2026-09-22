#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

# shellcheck source=lib.sh
source "${ROOT}/lib.sh"
compose_cmd

load_env_files
ensure_service_ports

"${COMPOSE[@]}" ps
print_service_urls
