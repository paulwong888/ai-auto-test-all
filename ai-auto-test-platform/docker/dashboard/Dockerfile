FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY test-dashboard/package.json ./test-dashboard/
COPY test-server/package.json ./test-server/

RUN npm ci -w test-dashboard --include=dev

COPY test-dashboard ./test-dashboard

RUN npm run build -w test-dashboard

FROM nginx:1.27-alpine

COPY docker/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/test-dashboard/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
