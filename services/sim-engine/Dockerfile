FROM node:20-alpine

WORKDIR /app

# Монорепо на npm workspaces: копируем корневые манифесты + манифест сервиса,
# чтобы npm install корректно разрешил workspace-зависимости.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/sim-engine/package.json ./services/sim-engine/package.json
RUN npm install --workspace=@aurwin/sim-engine --include-workspace-root

COPY services/sim-engine ./services/sim-engine

WORKDIR /app/services/sim-engine
CMD ["npm", "run", "dev"]
