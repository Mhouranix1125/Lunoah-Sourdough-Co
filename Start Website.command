#!/bin/bash
# Double-click this file to start the Lunoah website on this computer.
# Keep this window open while using the site. Close it to stop.
cd "$(dirname "$0")" || exit 1
PB="$(command -v pocketbase || echo /opt/homebrew/bin/pocketbase)"
if [ ! -x "$PB" ]; then
  echo "PocketBase is not installed. Run:  brew install pocketbase"
  read -r -p "Press Enter to close."; exit 1
fi

PORT=8090
echo ""
echo "  Lunoah Sourdough Co. is starting…"
echo ""
echo "  Website:        http://localhost:$PORT"
echo "  Nadia's admin:  http://localhost:$PORT/admin"
echo ""
echo "  Keep this window open. Close it to stop the website."
echo ""
( sleep 2; open "http://localhost:$PORT/admin" ) &
exec "$PB" serve --http="127.0.0.1:$PORT" \
  --dir=pb_data --migrationsDir=pb_migrations --publicDir=pb_public --hooksDir=pb_hooks
