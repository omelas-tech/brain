# brain-store — the reference store server. No dependencies to install.
# Build from the repository root:  docker build -f store/Dockerfile -t brain-store .
FROM node:22-alpine

WORKDIR /app
COPY store/ ./store/

# Data lives on a volume, owned by the unprivileged user the server runs as.
RUN mkdir -p /data && chown node:node /data
USER node

ENV NODE_ENV=production \
    STORE_DATA_DIR=/data \
    STORE_HOST=0.0.0.0 \
    STORE_PORT=8787

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1

ENTRYPOINT ["node", "store/bin/brain-store.js"]
CMD ["serve"]
