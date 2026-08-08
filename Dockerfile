FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
RUN mkdir -p /data && chown node:node /data

ENV HOST=0.0.0.0
ENV PORT=3000
ENV LISTENER_DB_PATH=/data/listener.sqlite
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "server/containerHealthCheck.mjs"]

USER node
CMD ["node", "server/index.mjs"]
