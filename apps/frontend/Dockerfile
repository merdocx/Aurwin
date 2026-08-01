FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install --workspace=@aurwin/frontend --include-workspace-root

COPY apps/frontend ./apps/frontend

ARG VITE_API_URL=https://aurwin.ru
ARG VITE_WS_URL=wss://aurwin.ru/ws
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

WORKDIR /app/apps/frontend
RUN npm run build

# Статический сервер без проверки Host (vite preview даёт 403 за reverse-proxy
# без header_up Host) — надёжнее для production за Caddy.
RUN npm install -g serve@14
EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
