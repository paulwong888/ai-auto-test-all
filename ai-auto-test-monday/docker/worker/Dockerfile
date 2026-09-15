FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
COPY packages/agent-core/package.json ./packages/agent-core/
COPY worker/package.json ./worker/

RUN npm install -w @monday/agent-core -w @monday/worker --include=dev

COPY packages/agent-core ./packages/agent-core
COPY worker ./worker

RUN npm run build -w @monday/agent-core && npm run build -w @monday/worker

FROM node:22-bookworm-slim

WORKDIR /app

# OS libraries required by Playwright Chromium.
# Use the CLI's official dependency list (covers xvfb etc.) so the entrypoint
# does not need to apt-get on every container start.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*

ARG PLAYWRIGHT_VERSION=1.62.1
ENV PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION}
RUN npm install -g "@playwright/test@${PLAYWRIGHT_VERSION}" \
  && npx playwright install-deps chromium \
  && npx playwright install chromium \
  && npm uninstall -g @playwright/test \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY packages/agent-core/package.json ./packages/agent-core/
COPY worker/package.json ./worker/

RUN npm install -w @monday/agent-core -w @monday/worker --omit=dev

COPY --from=builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=builder /app/worker/dist ./worker/dist
COPY docker/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /app/worker
ENV NODE_ENV=production
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/worker.js"]
