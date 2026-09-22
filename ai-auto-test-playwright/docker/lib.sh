#!/usr/bin/env bash

compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    echo "Docker Compose is required." >&2
    exit 1
  fi
}

script_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")"
  pwd
}

load_env_files() {
  set -a
  [[ -f .env ]] && source .env
  [[ -f .env.local ]] && source .env.local
  set +a
}

load_runtime_env() {
  set -a
  [[ -f .infra.runtime ]] && source .infra.runtime
  set +a
}

tcp_open() {
  local host=$1
  local port=$2
  (echo >/dev/tcp/"${host}"/"${port}") >/dev/null 2>&1
}

postgres_ready() {
  local host=$1
  local port=$2
  if command -v pg_isready >/dev/null 2>&1; then
    pg_isready -h "${host}" -p "${port}" -q 2>/dev/null
    return $?
  fi
  tcp_open "${host}" "${port}"
}

redis_ready() {
  local host=$1
  local port=$2
  if command -v redis-cli >/dev/null 2>&1; then
    redis-cli -h "${host}" -p "${port}" ping 2>/dev/null | grep -q PONG
    return $?
  fi
  tcp_open "${host}" "${port}"
}

detect_local_postgres_port() {
  local ports="${LOCAL_POSTGRES_PORTS:-5432 5433}"
  local port
  for port in ${ports}; do
    if postgres_ready 127.0.0.1 "${port}"; then
      echo "${port}"
      return 0
    fi
  done
  return 1
}

detect_local_redis_port() {
  local port="${LOCAL_REDIS_PORT:-6379}"
  if redis_ready 127.0.0.1 "${port}"; then
    echo "${port}"
    return 0
  fi
  return 1
}

truthy() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

falsy() {
  case "${1:-}" in
    0 | false | FALSE | no | NO) return 0 ;;
    *) return 1 ;;
  esac
}

postgres_container_for_port() {
  local port=$1
  local line name ports
  while IFS= read -r line; do
    name=${line%% *}
    ports=${line#* }
    if [[ "${ports}" == *":${port}->"* ]]; then
      echo "${name}"
      return 0
    fi
  done < <(docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null)
  return 1
}

psql_run() {
  local host=$1
  local port=$2
  local user=$3
  local password=$4
  local mode=$5
  local sql=$6
  local args=()

  case "${mode}" in
    query) args=(-tAc "${sql}") ;;
    command) args=(-c "${sql}") ;;
    *) echo "psql_run: unknown mode ${mode}" >&2; return 1 ;;
  esac

  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="${password}" psql -h "${host}" -p "${port}" -U "${user}" -d postgres "${args[@]}"
    return $?
  fi

  local container
  if container=$(postgres_container_for_port "${port}"); then
    docker exec -e PGPASSWORD="${password}" "${container}" \
      psql -U "${user}" -d postgres "${args[@]}"
    return $?
  fi

  docker run --rm -e PGPASSWORD="${password}" --add-host=host.docker.internal:host-gateway \
    postgres:16-alpine \
    psql -h host.docker.internal -p "${port}" -U "${user}" -d postgres "${args[@]}"
}

ensure_postgres_database() {
  local host=$1
  local port=$2
  local db=${POSTGRES_DB:-ai_auto_test_playwright}
  local user=${POSTGRES_USER:-postgres}
  local password=${POSTGRES_PASSWORD:-postgres}

  local exists
  exists=$(psql_run "${host}" "${port}" "${user}" "${password}" query \
    "SELECT 1 FROM pg_database WHERE datname='${db}'" 2>/dev/null || true)
  if [[ "${exists}" != "1" ]]; then
    echo "[infra] creating postgres database '${db}' on ${host}:${port}"
    psql_run "${host}" "${port}" "${user}" "${password}" command \
      "CREATE DATABASE \"${db}\";" >/dev/null
  fi
}

resolve_infra() {
  local use_local_postgres=0
  local use_local_redis=0
  local bundled_postgres=0
  local bundled_redis=0
  local postgres_host="postgres"
  local postgres_port="5432"
  local redis_url="redis://redis:6379"
  local profiles=()
  local local_pg_port=""
  local local_redis_port=""

  if falsy "${USE_LOCAL_POSTGRES:-}"; then
    bundled_postgres=1
  elif truthy "${USE_LOCAL_POSTGRES:-}"; then
    use_local_postgres=1
  elif local_pg_port=$(detect_local_postgres_port); then
    use_local_postgres=1
  else
    bundled_postgres=1
  fi

  if falsy "${USE_LOCAL_REDIS:-}"; then
    bundled_redis=1
  elif truthy "${USE_LOCAL_REDIS:-}"; then
    use_local_redis=1
  elif local_redis_port=$(detect_local_redis_port); then
    use_local_redis=1
  else
    bundled_redis=1
  fi

  if [[ "${use_local_postgres}" == "1" ]]; then
    if [[ -z "${local_pg_port}" ]]; then
      local_pg_port=$(detect_local_postgres_port) || {
        echo "[infra] USE_LOCAL_POSTGRES=1 but no local postgres found on ${LOCAL_POSTGRES_PORTS:-5432 5433}" >&2
        exit 1
      }
    fi
    postgres_host="${LOCAL_POSTGRES_HOST:-host.docker.internal}"
    postgres_port="${local_pg_port}"
    ensure_postgres_database 127.0.0.1 "${local_pg_port}"
  else
    profiles+=("with-postgres")
    postgres_host="postgres"
    postgres_port="5432"
  fi

  if [[ "${use_local_redis}" == "1" ]]; then
    if [[ -z "${local_redis_port}" ]]; then
      local_redis_port=$(detect_local_redis_port) || {
        echo "[infra] USE_LOCAL_REDIS=1 but no local redis found on ${LOCAL_REDIS_PORT:-6379}" >&2
        exit 1
      }
    fi
    redis_url="redis://${LOCAL_REDIS_HOST:-host.docker.internal}:${local_redis_port}"
  else
    profiles+=("with-redis")
    redis_url="redis://redis:6379"
  fi

  local profiles_csv=""
  if ((${#profiles[@]} > 0)); then
    profiles_csv=$(IFS=,; echo "${profiles[*]}")
  fi

  cat > .infra.runtime <<EOF
COMPOSE_PROFILES=${profiles_csv}
POSTGRES_HOST=${postgres_host}
POSTGRES_PORT=${postgres_port}
REDIS_URL=${redis_url}
USE_LOCAL_POSTGRES=${use_local_postgres}
USE_LOCAL_REDIS=${use_local_redis}
EOF

  export COMPOSE_PROFILES="${profiles_csv}"
  export POSTGRES_HOST="${postgres_host}"
  export POSTGRES_PORT="${postgres_port}"
  export REDIS_URL="${redis_url}"

  echo "[infra] postgres: $(
    if [[ "${use_local_postgres}" == "1" ]]; then
      echo "local ${postgres_host}:${postgres_port}"
    else
      echo "bundled container (host port ${POSTGRES_HOST_PORT:-5434})"
    fi
  )"
  echo "[infra] redis: $(
    if [[ "${use_local_redis}" == "1" ]]; then
      echo "local ${redis_url}"
    else
      echo "bundled container (host port ${REDIS_HOST_PORT:-6379})"
    fi
  )"
}

compose_profiles_for_down() {
  echo "with-postgres,with-redis"
}

pick_port_if_busy() {
  local var_name=$1
  local start_port=$2
  local attempts=${3:-20}
  local port=${!var_name:-$start_port}
  local i

  for ((i = 0; i < attempts; i++)); do
    if ! tcp_open 127.0.0.1 "${port}"; then
      printf -v "${var_name}" '%s' "${port}"
      export "${var_name?}"
      return 0
    fi
    ((port++))
  done

  echo "[infra] no free port found near ${start_port}" >&2
  exit 1
}

warn_llm_config() {
  if [[ ! -f .env.local ]]; then
    echo "[infra] WARN: docker/.env.local missing; Pi plan/code will fail without LLM config." >&2
    return
  fi

  local key
  key=$(grep -E '^DASHSCOPE_API_KEY=' .env.local | head -1 | cut -d= -f2- || true)
  if [[ -z "${key}" ]] || [[ "${key}" == *"替换"* ]]; then
    echo "[infra] WARN: DASHSCOPE_API_KEY is unset or still placeholder in .env.local" >&2
    echo "[infra]       Local vLLM: use ASCII key e.g. DASHSCOPE_API_KEY=local-dev" >&2
  elif [[ ! "${key}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "[infra] WARN: DASHSCOPE_API_KEY must be ASCII-only (no Chinese characters)." >&2
  fi
}

ensure_recorder_image() {
  if falsy "${RECORDER_BUILD:-1}"; then
    echo "[infra] recorder image build skipped (RECORDER_BUILD=0)"
    return 0
  fi

  local image="${RECORDER_IMAGE:-ai-auto-test-playwright-recorder:latest}"
  if docker image inspect "${image}" >/dev/null 2>&1; then
    echo "[infra] recorder image: ${image}"
    return 0
  fi

  local project_root
  project_root="$(cd "${ROOT}/.." && pwd)"
  echo "[infra] building recorder image ${image} (first run may take several minutes)..."
  docker build -f "${ROOT}/recorder/Dockerfile" -t "${image}" "${project_root}"
}

persist_effective_ports() {
  cat > .ports.runtime <<EOF
EFFECTIVE_DASHBOARD_PORT=${DASHBOARD_PORT}
EFFECTIVE_SERVER_PORT=${SERVER_PORT:-3002}
EOF
}

ensure_service_ports() {
  local configured=${DASHBOARD_PORT:-8042}

  if [[ -f .ports.runtime ]]; then
    # shellcheck disable=SC1091
    source .ports.runtime
    if [[ -n "${EFFECTIVE_DASHBOARD_PORT:-}" ]] && ! tcp_open 127.0.0.1 "${EFFECTIVE_DASHBOARD_PORT}"; then
      export DASHBOARD_PORT="${EFFECTIVE_DASHBOARD_PORT}"
      export PORT="${SERVER_PORT:-3002}"
      echo "[infra] dashboard port: ${DASHBOARD_PORT} (from .ports.runtime)"
      return
    fi
  fi

  if ! tcp_open 127.0.0.1 "${configured}"; then
    export DASHBOARD_PORT="${configured}"
  else
    pick_port_if_busy DASHBOARD_PORT "${configured}"
    echo "[infra] DASHBOARD_PORT ${configured} busy, using ${DASHBOARD_PORT}" >&2
    echo "[infra] tip: set DASHBOARD_PORT=${DASHBOARD_PORT} in .env to keep this port" >&2
  fi

  export PORT="${SERVER_PORT:-3002}"
  persist_effective_ports
}

print_service_urls() {
  echo
  echo "=========================================="
  echo "  Dashboard: http://localhost:${DASHBOARD_PORT}/projects"
  echo "  API:       http://localhost:${SERVER_PORT:-3002}"
  echo "  Health:    http://localhost:${DASHBOARD_PORT}/health"
  echo "=========================================="
  echo
}
