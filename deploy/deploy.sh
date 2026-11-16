#!/bin/bash
# Puts the Lunoah website on a fresh Ubuntu server, or updates it.
#
#   First time (copies the database and photos too):  deploy/deploy.sh SERVER_IP --with-data
#   Later updates (site files only, data untouched):  deploy/deploy.sh SERVER_IP
#
# Needs: you can already `ssh root@SERVER_IP` (add your SSH key when you create the server).
# It never uploads stripe.env from this computer: live keys go on the server only (LAUNCH-PLAN.md §4).
set -euo pipefail
cd "$(dirname "$0")/.."

IP="${1:?Usage: deploy/deploy.sh SERVER_IP [--with-data]}"
WITH_DATA="${2:-}"
PB_VERSION="0.41.1"
SSH="ssh -o StrictHostKeyChecking=accept-new root@$IP"

echo "→ Running the tests first"
node --test >/dev/null || { echo "Tests failed; nothing was uploaded."; exit 1; }

echo "→ Preparing the server"
$SSH bash -s <<EOF
set -e
mkdir -p /opt/lunoah
if [ ! -x /opt/lunoah/pocketbase ] || ! /opt/lunoah/pocketbase --version | grep -q "$PB_VERSION"; then
  apt-get update -qq && apt-get install -y -qq unzip curl rsync >/dev/null
  ARCH=\$(dpkg --print-architecture)   # amd64 or arm64
  cd /tmp && curl -sSLo pb.zip "https://ganigeorgiev.com/meta/pocketbase/pocketbase/download/v$PB_VERSION/pocketbase_${PB_VERSION}_linux_\${ARCH}.zip"
  unzip -o -q pb.zip pocketbase -d /opt/lunoah && rm pb.zip
fi
if command -v ufw >/dev/null; then ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null; fi
EOF

echo "→ Uploading the site"
if [ "$WITH_DATA" = "--with-data" ]; then
  if $SSH test -d /opt/lunoah/pb_data; then
    echo "The server already has a database. Refusing to overwrite it."
    echo "(To replace it on purpose, delete /opt/lunoah/pb_data on the server first.)"
    exit 1
  fi
  # A consistent copy even while the local site is running.
  TMP=$(mktemp -d)
  cp -R pb_data "$TMP/pb_data"
  for db in data auxiliary; do
    [ -f "pb_data/$db.db" ] && sqlite3 "pb_data/$db.db" ".backup '$TMP/pb_data/$db.db'"
    rm -f "$TMP/pb_data/$db.db-wal" "$TMP/pb_data/$db.db-shm"
  done
  rm -rf "$TMP/pb_data/backups"
  rsync -az "$TMP/pb_data" root@"$IP":/opt/lunoah/
  rm -rf "$TMP"
fi
rsync -az --delete pb_public pb_migrations pb_hooks root@"$IP":/opt/lunoah/
scp -q deploy/lunoah.service root@"$IP":/etc/systemd/system/lunoah.service

echo "→ Starting it"
$SSH "systemctl daemon-reload && systemctl enable lunoah >/dev/null 2>&1 && systemctl restart lunoah && sleep 3 && systemctl is-active lunoah"

echo ""
echo "Done. Once DNS points at $IP: https://lunoahsourdoughco.com"
$SSH test -f /opt/lunoah/stripe.env || echo "Online ordering stays paused until /opt/lunoah/stripe.env exists on the server (LAUNCH-PLAN.md §4)."
