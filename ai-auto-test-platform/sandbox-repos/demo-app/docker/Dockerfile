FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN npx vite build

FROM nginx:1.27-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
