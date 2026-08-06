FROM node:20-slim AS builder

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY

RUN npm install -g bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

ARG API_PROXY_HOST=http://backend:8000
ENV API_PROXY_HOST=$API_PROXY_HOST

RUN bun run build

# next.config.js 已配置 output: 'standalone'——运行镜像只带 standalone server
# 和静态资源，不带 node_modules（1.4GB -> ~200MB）。保持 node 运行时不变
# （standalone 即 node server.js），bun 只用于装依赖和构建。
FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
