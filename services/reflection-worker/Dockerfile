FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/reflection-worker/package.json ./services/reflection-worker/package.json
RUN npm install --workspace=@aurwin/reflection-worker --include-workspace-root

COPY services/reflection-worker ./services/reflection-worker
# config/constants.yaml — единый источник правды для констант рефлексии
# (CLAUDE.md, п.3; services/reflection-worker/src/constants.ts читает его по
# относительному пути от services/reflection-worker) — без этой строки
# constants.ts падал бы на старте контейнера (ENOENT), см. ops/DEVIATIONS.md,
# фаза 6 (та же строка уже есть в services/sim-engine/Dockerfile).
COPY config ./config

WORKDIR /app/services/reflection-worker
CMD ["npm", "run", "dev"]
