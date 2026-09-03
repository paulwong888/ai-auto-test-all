FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
COPY packages/agent-core/package.json ./packages/agent-core/
COPY api/package.json ./api/
COPY worker/package.json ./worker/

RUN npm install -w @monday/agent-core -w @monday/api --include=dev

COPY packages/agent-core ./packages/agent-core
COPY api ./api

RUN npm run build -w @monday/agent-core && npm run build -w @monday/api

FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY packages/agent-core/package.json ./packages/agent-core/
COPY api/package.json ./api/

RUN npm install -w @monday/agent-core -w @monday/api --omit=dev

COPY --from=builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=builder /app/api/dist ./api/dist
COPY --from=builder /app/api/src/db/migrations ./api/dist/db/migrations

WORKDIR /app/api
ENV NODE_ENV=production
EXPOSE 3010
CMD ["node", "dist/index.js"]
