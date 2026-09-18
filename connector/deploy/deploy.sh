#!/usr/bin/env bash
# Deploy brain-connector to the VPS (co-located with brain-cloud).
# Layout on the box: /opt/brain-connector/{bin,src,connector,store/lib} so the
# connector's engine bridge resolves ../../bin/recall.js and the OIDC provider
# resolves ../../store/lib/oidc.js. .env is NOT synced (set on the box once).
set -euo pipefail

VPS="${VPS:?set VPS=user@host (the box running brain-cloud)}"
DEST=/opt/brain-connector
REPO="$(cd "$(dirname "$0")/../.." && pwd)"   # brain repo root

# This script ships the WORKING TREE, not a commit. Refuse to send uncommitted
# changes to production by accident. Deploy from a clean checkout instead:
#   git worktree add /tmp/brain-deploy HEAD && VPS=... bash /tmp/brain-deploy/connector/deploy/deploy.sh
# ALLOW_DIRTY=1 overrides.
if [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  dirty="$(git -C "$REPO" status --porcelain -- bin src connector store/lib 2>/dev/null || true)"
  if [ -n "$dirty" ]; then
    echo "Refusing to deploy: uncommitted changes under bin/, src/, connector/ or store/lib/:" >&2
    echo "$dirty" >&2
    echo "Deploy from a clean checkout, or set ALLOW_DIRTY=1." >&2
    exit 1
  fi
fi

echo "→ syncing engine + connector to $VPS:$DEST"
rsync -az --delete "$REPO/bin/" "$VPS:$DEST/bin/"
rsync -az --delete "$REPO/src/" "$VPS:$DEST/src/"
rsync -az --delete --exclude node_modules --exclude .env "$REPO/connector/" "$VPS:$DEST/connector/"
ssh "$VPS" "mkdir -p $DEST/store/lib"
rsync -az --delete "$REPO/store/lib/" "$VPS:$DEST/store/lib/"

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

# Per-user brain working copies live on a RAM tmpfs (/run/brain-connector), created
# by the systemd RuntimeDirectory — nothing to provision on disk. Remove any stale
# plaintext cache from the pre-tmpfs layout.
rm -rf /opt/brain-connector/users 2>/dev/null || true

# The code tree is read-only to the service; .env holds config (public Firebase
# web values today, but lock it down regardless) and must be readable by it only.
chown -R root:root /opt/brain-connector/bin /opt/brain-connector/src /opt/brain-connector/connector /opt/brain-connector/store 2>/dev/null || true
if [ -f .env ]; then chown brainconn:brainconn .env && chmod 600 .env; fi

# Encryption key for OAuth state at rest (Firebase refresh tokens inside
# /var/lib/brain-connector) — generate once; keeping it in .env (a different
# path from the data) means an exfiltrated state file alone is useless.
if [ -f .env ] && ! grep -q '^CONNECTOR_STATE_KEY=' .env; then
  echo "CONNECTOR_STATE_KEY=$(openssl rand -hex 32)" >> .env
  chown brainconn:brainconn .env && chmod 600 .env
  echo "generated CONNECTOR_STATE_KEY in .env"
fi

cp deploy/brain-connector.service /etc/systemd/system/brain-connector.service
systemctl daemon-reload
systemctl enable brain-connector >/dev/null 2>&1 || true
systemctl restart brain-connector
sleep 3
echo "service: $(systemctl is-active brain-connector)"
echo "health:  $(curl -s http://127.0.0.1:8788/health || echo UNREACHABLE)"
REMOTE
echo "→ done"
