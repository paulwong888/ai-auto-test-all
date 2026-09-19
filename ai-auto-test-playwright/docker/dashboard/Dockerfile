FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY dashboard/package.json ./dashboard/
COPY server/package.json ./server/

RUN npm ci -w dashboard --include=dev

COPY dashboard ./dashboard

RUN npm run build -w dashboard

FROM nginx:1.27-alpine

COPY docker/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
