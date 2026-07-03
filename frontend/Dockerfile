FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

ARG API_PROXY_HOST=http://backend:8000
ENV API_PROXY_HOST=$API_PROXY_HOST

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
