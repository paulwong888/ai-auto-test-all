#!/bin/sh
set -eu

PI_AGENT_DIR="/root/.pi/agent"
mkdir -p "$PI_AGENT_DIR"

HIGRESS_BASE_URL="${HIGRESS_BASE_URL:-http://host.docker.internal:8004/v1}"
HIGRESS_API_KEY="${HIGRESS_API_KEY:-not-needed}"
PI_MODEL="${PI_MODEL:-qwen-32b}"

sed \
  -e "s|__LLM_BASE_URL__|${HIGRESS_BASE_URL}|g" \
  -e "s|__LLM_API_KEY__|${HIGRESS_API_KEY}|g" \
  -e "s|__PI_MODEL__|${PI_MODEL}|g" \
  /etc/pi-agent/models.json.template > "${PI_AGENT_DIR}/models.json"

sed \
  -e "s|__PI_MODEL__|${PI_MODEL}|g" \
  /etc/pi-agent/settings.json.template > "${PI_AGENT_DIR}/settings.json"

exec node dist/index.js
