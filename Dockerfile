# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY tsconfig.json postcss.config.mjs ./
COPY scripts ./scripts
COPY src ./src
COPY frontend ./frontend

RUN npm ci
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV LLMPROXY_CONFIG=/data/llmproxy.config.json

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN mkdir -p /data \
  && chown -R node:node /app /data

USER node

EXPOSE 4100
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
