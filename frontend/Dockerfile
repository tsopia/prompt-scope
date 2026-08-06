FROM node:20-slim

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

EXPOSE 3000

CMD ["bun", "run", "start"]
