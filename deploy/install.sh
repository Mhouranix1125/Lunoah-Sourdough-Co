#!/bin/bash
# Installs the Lunoah website on an Ubuntu server, or updates it to the latest version on GitHub.
# Runs ON the server, so it works from the hosting provider's web console in any browser.
# Paste this one line (the same line installs the first time and updates later):
#
#   curl -fsSL https://raw.githubusercontent.com/Mhouranix1125/Lunoah-Sourdough-Co/main/deploy/install.sh | sudo bash
#
# Layout on the server:
#   /opt/lunoah/site        the code, a copy of the GitHub repo (replaced on every update)
#   /opt/lunoah/pb_data     the database and photos (never touched by updates)
#   /opt/lunoah/stripe.env  live Stripe keys (you create it, LAUNCH-PLAN.md §4)
set -euo pipefail

REPO="${LUNOAH_REPO:-https://github.com/Mhouranix1125/Lunoah-Sourdough-Co.git}"
BRANCH="${LUNOAH_BRANCH:-main}"
PB_VERSION="0.41.1"
ROOT=/opt/lunoah

[ "$(id -u)" = 0 ] || { echo "Run it with sudo."; exit 1; }
FIRST=0; [ -d "$ROOT/pb_data" ] || FIRST=1

echo "→ Installing tools"
export DEBIAN_FRONTEND=noninteractive
command -v git >/dev/null && command -v unzip >/dev/null && command -v curl >/dev/null || {
  apt-get update -qq && apt-get install -y -qq git unzip curl ca-certificates >/dev/null
}
mkdir -p "$ROOT"

if [ ! -x "$ROOT/pocketbase" ] || ! "$ROOT/pocketbase" --version | grep -q " $PB_VERSION\$"; then
  echo "→ Installing PocketBase $PB_VERSION"
  ARCH=$(dpkg --print-architecture)   # amd64 or arm64
  TMP=$(mktemp -d)
  # Official download (linked from pocketbase.io; newer versions are not on GitHub).
  curl -fsSLo "$TMP/pb.zip" "https://ganigeorgiev.com/meta/pocketbase/pocketbase/download/v$PB_VERSION/pocketbase_${PB_VERSION}_linux_${ARCH}.zip"
  unzip -o -q "$TMP/pb.zip" pocketbase -d "$TMP" && install -m 755 "$TMP/pocketbase" "$ROOT/pocketbase"
  rm -rf "$TMP"
fi

echo "→ Getting the latest site from GitHub ($BRANCH)"
NEW="$ROOT/site.new"
rm -rf "$NEW"
git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$NEW"
OLD_REV=$(git -C "$ROOT/site" rev-parse --short HEAD 2>/dev/null || echo none)
NEW_REV=$(git -C "$NEW" rev-parse --short HEAD)
rm -rf "$ROOT/site.old"
[ -d "$ROOT/site" ] && mv "$ROOT/site" "$ROOT/site.old"
mv "$NEW" "$ROOT/site"

install -m 644 "$ROOT/site/deploy/lunoah.service" /etc/systemd/system/lunoah.service

if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

if [ "$FIRST" = 1 ]; then
  # Create the database now so the site-admin account can be made before anyone else visits.
  "$ROOT/pocketbase" migrate up --dir="$ROOT/pb_data" --migrationsDir="$ROOT/site/pb_migrations" >/dev/null
fi

echo "→ Starting the site ($OLD_REV → $NEW_REV)"
systemctl daemon-reload
systemctl enable lunoah >/dev/null 2>&1
START=$(date '+%Y-%m-%d %H:%M:%S')
systemctl restart lunoah
sleep 5
# PocketBase keeps running even if one of the site's server files fails to load, so read the log too.
if ! systemctl is-active --quiet lunoah || \
   journalctl -u lunoah --since "$START" --no-pager | grep -qiE "failed to execute|SyntaxError|panic|failed to apply"; then
  echo ""
  echo "The site did not start cleanly. Log:"
  journalctl -u lunoah --since "$START" --no-pager | tail -20
  if [ -d "$ROOT/site.old" ]; then
    echo "Going back to the previous version ($OLD_REV)."
    rm -rf "$ROOT/site" && mv "$ROOT/site.old" "$ROOT/site"
    install -m 644 "$ROOT/site/deploy/lunoah.service" /etc/systemd/system/lunoah.service
    systemctl daemon-reload && systemctl restart lunoah
  fi
  exit 1
fi

echo ""
echo "✓ Lunoah is running ($NEW_REV)."
[ -f "$ROOT/stripe.env" ] || echo "  Online ordering is paused until $ROOT/stripe.env exists (LAUNCH-PLAN.md §4)."
if [ "$FIRST" = 1 ]; then
  echo ""
  echo "Next, create your site-admin login (use your own email and a strong password):"
  echo "  sudo $ROOT/pocketbase superuser upsert YOU@example.com 'A-Strong-Password' --dir=$ROOT/pb_data"
fi
