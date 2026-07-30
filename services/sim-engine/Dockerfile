FROM node:20-alpine

WORKDIR /app

# Монорепо на npm workspaces: копируем корневые манифесты + манифест сервиса,
# чтобы npm install корректно разрешил workspace-зависимости.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/sim-engine/package.json ./services/sim-engine/package.json
RUN npm install --workspace=@aurwin/sim-engine --include-workspace-root

COPY services/sim-engine ./services/sim-engine
# config/constants.yaml — единый источник правды для констант симуляции
# (CLAUDE.md, п.3); world/constants.ts читает его по относительному пути
# от services/sim-engine, поэтому файл должен быть в образе.
COPY config ./config

WORKDIR /app/services/sim-engine
CMD ["npm", "run", "dev"]
