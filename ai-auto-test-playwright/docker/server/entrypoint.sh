#!/bin/sh
set -eu

PI_AGENT_DIR="/root/.pi/agent"
mkdir -p "$PI_AGENT_DIR"

LLM_BASE_URL="${LLM_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-not-configured}"
PI_MODEL="${PI_MODEL:-qwen-plus}"

case "${DASHSCOPE_API_KEY}" in
  *[!A-Za-z0-9._-]*)
    echo "[entrypoint] WARN: DASHSCOPE_API_KEY contains non-ASCII characters; Pi LLM calls will fail." >&2
    echo "[entrypoint]       Use an ASCII key (e.g. local-dev for local vLLM)." >&2
    ;;
esac

sed \
  -e "s|__LLM_BASE_URL__|${LLM_BASE_URL}|g" \
  -e "s|__LLM_API_KEY__|${DASHSCOPE_API_KEY}|g" \
  -e "s|__PI_MODEL__|${PI_MODEL}|g" \
  /etc/pi-agent/models.json.template > "${PI_AGENT_DIR}/models.json"

sed \
  -e "s|__PI_MODEL__|${PI_MODEL}|g" \
  /etc/pi-agent/settings.json.template > "${PI_AGENT_DIR}/settings.json"

SKILLS_SRC="/etc/pi-agent/skills"
SKILLS_DEST="${PI_AGENT_DIR}/skills"
mkdir -p "$SKILLS_DEST"
cp -a "${SKILLS_SRC}/." "${SKILLS_DEST}/"

exec npm run start -w server
