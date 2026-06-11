FROM node:20-slim
WORKDIR /app

RUN npm install -g pnpm@10

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server run build

ENV PORT=8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
