#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT}"

# shellcheck source=lib.sh
source "${ROOT}/lib.sh"
compose_cmd

if [[ ! -f .env ]] && [[ -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

if [[ ! -f .env.local ]] && [[ -f .env.local.example ]]; then
  cp .env.local.example .env.local
  echo "Created .env.local from .env.local.example (fill DASHSCOPE_API_KEY before using Pi)"
fi

mkdir -p "${PROJECTS_DATA_HOST_PATH:-./data/projects}"

load_env_files
warn_llm_config
ensure_service_ports
resolve_infra
ensure_recorder_image

"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" ps

print_service_urls
