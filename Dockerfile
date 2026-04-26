FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
 && npm config set update-notifier false
COPY package*.json ./
RUN npm install --omit=dev \
 && apk del python3 make g++

FROM node:22-alpine AS runtime
RUN apk add --no-cache iputils tini \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=app:app package*.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app public ./public

RUN mkdir -p /app/data && chown -R app:app /app/data
USER app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/spark.db

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:${PORT}/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
