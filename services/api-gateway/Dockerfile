FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/api-gateway/package.json ./services/api-gateway/package.json
RUN npm install --workspace=@aurwin/api-gateway --include-workspace-root

COPY services/api-gateway ./services/api-gateway
# config/constants.yaml — единый источник правды для констант (CLAUDE.md, п.3);
# src/config.ts читает его по относительному пути от services/api-gateway.
COPY config ./config

WORKDIR /app/services/api-gateway
RUN npm run build
CMD ["npm", "run", "start"]
