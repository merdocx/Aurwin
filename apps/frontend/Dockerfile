FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/frontend/package.json ./apps/frontend/package.json
RUN npm install --workspace=@aurwin/frontend --include-workspace-root

COPY apps/frontend ./apps/frontend

WORKDIR /app/apps/frontend
CMD ["npm", "run", "dev", "--", "--host"]
