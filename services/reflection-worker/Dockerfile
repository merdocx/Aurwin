FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY services/reflection-worker/package.json ./services/reflection-worker/package.json
RUN npm install --workspace=@aurwin/reflection-worker --include-workspace-root

COPY services/reflection-worker ./services/reflection-worker

WORKDIR /app/services/reflection-worker
CMD ["npm", "run", "dev"]
