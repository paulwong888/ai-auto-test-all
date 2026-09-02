FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.5.1 --activate

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile

COPY . .

ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_ASSISTANT_ID=api-test-platform
ARG NEXT_PUBLIC_MANAGEMENT_API_URL=/management-api
ARG MANAGEMENT_API_URL=http://api:8100

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_ASSISTANT_ID=$NEXT_PUBLIC_ASSISTANT_ID
ENV NEXT_PUBLIC_MANAGEMENT_API_URL=$NEXT_PUBLIC_MANAGEMENT_API_URL
ENV MANAGEMENT_API_URL=$MANAGEMENT_API_URL

RUN pnpm build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN corepack enable && corepack prepare pnpm@10.5.1 --activate

COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./

EXPOSE 3000

CMD ["pnpm", "start", "-p", "3000", "-H", "0.0.0.0"]
