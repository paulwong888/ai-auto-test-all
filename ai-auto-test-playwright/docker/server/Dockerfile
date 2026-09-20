FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g @earendil-works/pi-coding-agent

COPY package.json package-lock.json ./
COPY server/package.json ./server/

COPY server/tsconfig.json ./server/
COPY server/migrations ./server/migrations
COPY server/src ./server/src
COPY templates ./templates

RUN npm install --workspace=server && npm run build -w server

COPY docker/pi-agent/models.json.template /etc/pi-agent/models.json.template
COPY docker/pi-agent/settings.json.template /etc/pi-agent/settings.json.template
COPY docker/skills /etc/pi-agent/skills
COPY docker/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
