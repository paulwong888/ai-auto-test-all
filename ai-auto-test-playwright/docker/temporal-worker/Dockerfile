FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY temporal-worker/package.json ./temporal-worker/

RUN npm install --workspace=temporal-worker

COPY temporal-worker/tsconfig.json ./temporal-worker/
COPY temporal-worker/scripts ./temporal-worker/scripts
COPY temporal-worker/src ./temporal-worker/src

RUN npm run build -w temporal-worker

ENV NODE_ENV=production

CMD ["npm", "run", "start", "-w", "temporal-worker"]
