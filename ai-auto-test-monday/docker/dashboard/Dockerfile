FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./
COPY dashboard/package.json ./dashboard/

RUN npm install -w @monday/dashboard --include=dev

COPY dashboard ./dashboard

RUN npm run build -w @monday/dashboard

FROM nginx:1.27-alpine

COPY docker/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dashboard/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
