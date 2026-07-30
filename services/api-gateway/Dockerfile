FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/api-gateway/package.json ./services/api-gateway/package.json
RUN npm install --workspace=@aurwin/api-gateway --include-workspace-root

COPY services/api-gateway ./services/api-gateway

WORKDIR /app/services/api-gateway
CMD ["npm", "run", "dev"]
