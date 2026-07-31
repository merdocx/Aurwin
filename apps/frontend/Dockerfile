FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install --workspace=@aurwin/frontend --include-workspace-root

COPY apps/frontend ./apps/frontend

# Production build: VITE_* вшиваются на этапе vite build (import.meta.env).
# Значения по умолчанию — публичный домен; docker-compose передаёт build-args.
ARG VITE_API_URL=https://aurwin.ru
ARG VITE_WS_URL=wss://aurwin.ru/ws
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

WORKDIR /app/apps/frontend
RUN npm run build

EXPOSE 5173
CMD ["npm", "run", "preview", "--", "--host", "--port", "5173"]
