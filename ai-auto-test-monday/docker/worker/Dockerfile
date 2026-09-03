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

COPY package.json ./
COPY packages/agent-core/package.json ./packages/agent-core/
COPY worker/package.json ./worker/

RUN npm install -w @monday/agent-core -w @monday/worker --omit=dev

COPY --from=builder /app/packages/agent-core/dist ./packages/agent-core/dist
COPY --from=builder /app/worker/dist ./worker/dist

WORKDIR /app/worker
ENV NODE_ENV=production
CMD ["node", "dist/worker.js"]
