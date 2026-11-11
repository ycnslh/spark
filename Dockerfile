FROM node:22.23.5-alpine@sha256:f4081a5ddded4f76ddd2ae8cc37b3d817926871c64b11b8f684be2a588a7792d AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ \
 && npm config set update-notifier false
COPY package*.json ./
RUN npm ci --omit=dev \
 && apk del python3 make g++

FROM node:22.23.5-alpine@sha256:f4081a5ddded4f76ddd2ae8cc37b3d817926871c64b11b8f684be2a588a7792d AS runtime
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
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))" || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
