FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY test-server/package.json ./test-server/
COPY test-dashboard/package.json ./test-dashboard/

RUN npm ci -w test-server --include=dev

COPY test-server ./test-server

RUN npm run build -w test-server

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g @earendil-works/pi-coding-agent \
  && npx playwright install chromium --with-deps

COPY package.json package-lock.json ./
COPY test-server/package.json ./test-server/
COPY test-dashboard/package.json ./test-dashboard/

RUN npm ci -w test-server --omit=dev

COPY --from=builder /app/test-server/dist ./test-server/dist
COPY test-server/templates ./test-server/templates
COPY test-server/audit-profiles ./test-server/audit-profiles
COPY sandbox-repos ./sandbox-repos

COPY docker/pi-agent/models.json.template /etc/pi-agent/models.json.template
COPY docker/pi-agent/settings.json.template /etc/pi-agent/settings.json.template
COPY docker/server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/test-server

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
