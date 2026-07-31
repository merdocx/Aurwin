FROM node:20-alpine

WORKDIR /app

# Монорепо на npm workspaces: копируем корневые манифесты + манифест сервиса,
# чтобы npm install корректно разрешил workspace-зависимости (тот же приём,
# что и в services/sim-engine/Dockerfile и др.).
COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/db/package.json ./services/db/package.json
RUN npm install --workspace=@aurwin/db --include-workspace-root

COPY services/db ./services/db

WORKDIR /app/services/db
# Без CMD-значения по умолчанию, кроме no-op: этот сервис не является
# долгоживущим процессом (в отличие от sim-engine/reflection-worker/
# api-gateway) — он вызывается точечно через `docker compose run --rm
# db-maintenance <команда>` (миграции, ops/systemd/aurwin-retention.timer).
CMD ["true"]
