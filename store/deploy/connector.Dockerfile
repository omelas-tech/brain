# The MCP connector, configured for a self-hosted store.
# Build from the repository root:
#   docker build -f store/deploy/connector.Dockerfile -t brain-connector .
#
# The connector runs the repository's own command-line tools (bin/, src/) against
# each user's working copy, so the image carries those alongside connector/.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY bin/ ./bin/
COPY src/ ./src/
# The OpenID Connect token verifier is shared with the store.
COPY store/lib/ ./store/lib/

WORKDIR /app/connector
COPY connector/package.json connector/package-lock.json ./
# tsx runs the TypeScript sources directly and is a dev dependency.
RUN npm ci --include=dev && npm cache clean --force
COPY connector/tsconfig.json ./
COPY connector/src/ ./src/

RUN mkdir -p /var/lib/brain-connector && chown node:node /var/lib/brain-connector
USER node

ENV NODE_ENV=production \
    PORT=8788 \
    CONNECTOR_BIND_HOST=0.0.0.0 \
    CONNECTOR_IDP=static \
    CONNECTOR_BRAIN_BASE=/run/brain-connector \
    CONNECTOR_STATE_DIR=/var/lib/brain-connector

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8788/health >/dev/null || exit 1

CMD ["node", "--import", "tsx", "src/server.ts"]
