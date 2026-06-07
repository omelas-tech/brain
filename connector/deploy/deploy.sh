#!/usr/bin/env bash
# Deploy brain-connector to the VPS (co-located with brain-cloud).
# Layout on the box: /opt/brain-connector/{bin,src,connector} so the connector's
# engine bridge resolves ../../bin/recall.js. .env is NOT synced (set on the box once).
set -euo pipefail

VPS="${VPS:?set VPS=user@host (the box running brain-cloud)}"
DEST=/opt/brain-connector
REPO="$(cd "$(dirname "$0")/../.." && pwd)"   # brain repo root

echo "→ syncing engine + connector to $VPS:$DEST"
rsync -az --delete "$REPO/bin/" "$VPS:$DEST/bin/"
rsync -az --delete "$REPO/src/" "$VPS:$DEST/src/"
rsync -az --delete --exclude node_modules --exclude .env "$REPO/connector/" "$VPS:$DEST/connector/"

echo "→ installing deps + (re)starting service"
ssh "$VPS" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/brain-connector/connector
npm install --silent --no-audit --no-fund

# Dedicated unprivileged service account (no shell, no login) — the connector
# must not run as root (it shares the box with brain-cloud).
if ! id brainconn >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin -d /opt/brain-connector brainconn
fi

# The ONLY directory the service may write: per-user brain working copies.
install -d -o brainconn -g brainconn -m 0700 /opt/brain-connector/users

# The code tree is read-only to the service; .env holds config (public Firebase
# web values today, but lock it down regardless) and must be readable by it only.
chown -R root:root /opt/brain-connector/bin /opt/brain-connector/src /opt/brain-connector/connector 2>/dev/null || true
if [ -f .env ]; then chown brainconn:brainconn .env && chmod 600 .env; fi

cp deploy/brain-connector.service /etc/systemd/system/brain-connector.service
systemctl daemon-reload
systemctl enable brain-connector >/dev/null 2>&1 || true
systemctl restart brain-connector
sleep 3
echo "service: $(systemctl is-active brain-connector)"
echo "health:  $(curl -s http://127.0.0.1:8788/health || echo UNREACHABLE)"
REMOTE
echo "→ done"
