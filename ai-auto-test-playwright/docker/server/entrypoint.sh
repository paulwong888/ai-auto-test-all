#!/bin/sh
set -eu

PI_AGENT_DIR="/root/.pi/agent"
mkdir -p "$PI_AGENT_DIR"

LLM_BASE_URL="${LLM_BASE_URL:-https://dashscope.aliyuncs.com/compatible-mode/v1}"
DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-not-configured}"
PI_MODEL="${PI_MODEL:-qwen-plus}"

PI_EXTRA_MODELS="${PI_EXTRA_MODELS:-}"
MODELS_JSON="[{\"id\":\"${PI_MODEL}\"}"
if [ -n "$PI_EXTRA_MODELS" ]; then
  OLDIFS="$IFS"
  IFS=,
  for mid in $PI_EXTRA_MODELS; do
    mid=$(echo "$mid" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -z "$mid" ] && continue
    [ "$mid" = "$PI_MODEL" ] && continue
    MODELS_JSON="${MODELS_JSON},{\"id\":\"${mid}\"}"
  done
  IFS="$OLDIFS"
fi
MODELS_JSON="${MODELS_JSON}]"

sed \
  -e "s|__LLM_BASE_URL__|${LLM_BASE_URL}|g" \
  -e "s|__LLM_API_KEY__|${DASHSCOPE_API_KEY}|g" \
  -e "s|__PI_MODELS_JSON__|${MODELS_JSON}|g" \
  /etc/pi-agent/models.json.template > "${PI_AGENT_DIR}/models.json"

sed \
  -e "s|__PI_MODEL__|${PI_MODEL}|g" \
  /etc/pi-agent/settings.json.template > "${PI_AGENT_DIR}/settings.json"

SKILLS_SRC="/etc/pi-agent/skills"
SKILLS_DEST="${PI_AGENT_DIR}/skills"
mkdir -p "$SKILLS_DEST"
cp -a "${SKILLS_SRC}/." "${SKILLS_DEST}/"

exec npm run start -w server
