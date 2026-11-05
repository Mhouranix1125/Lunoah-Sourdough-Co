#!/bin/bash
# One-time setup: creates Nadia's login for /admin, and a technical "superuser"
# login for the full database dashboard at /_/ (for whoever maintains the site).
# Safe to run again to reset a password.
cd "$(dirname "$0")" || exit 1
PB="$(command -v pocketbase || echo /opt/homebrew/bin/pocketbase)"
PORT=8091

ask() { local v; read -r -p "$1" v; echo "$v"; }
askpw() {
  local a b
  while true; do
    read -r -s -p "$1" a; echo >&2
    read -r -s -p "  Type it again: " b; echo >&2
    if [ ${#a} -lt 8 ]; then echo "  Must be at least 8 characters." >&2
    elif [ "$a" != "$b" ]; then echo "  Didn't match, try again." >&2
    else echo "$a"; return; fi
  done
}

echo ""
echo "=== Lunoah setup ==="
echo ""
echo "Step 1: Technical (superuser) account, for the database dashboard"
SU_EMAIL=$(ask "  Email: ")
SU_PASS=$(askpw "  Password: ")
"$PB" migrate up --dir=pb_data --migrationsDir=pb_migrations >/dev/null
"$PB" superuser upsert "$SU_EMAIL" "$SU_PASS" --dir=pb_data || exit 1

echo ""
echo "Step 2: Nadia's login (for /admin)"
N_NAME=$(ask "  Her name: ")
N_EMAIL=$(ask "  Her email: ")
N_PASS=$(askpw "  Password for her: ")

"$PB" serve --http="127.0.0.1:$PORT" --dir=pb_data --migrationsDir=pb_migrations --publicDir=pb_public >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT
for _ in $(seq 1 30); do curl -s "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 0.3; done

SU_EMAIL="$SU_EMAIL" SU_PASS="$SU_PASS" N_NAME="$N_NAME" N_EMAIL="$N_EMAIL" N_PASS="$N_PASS" PORT="$PORT" \
/usr/bin/python3 -I - <<'PY'
import json, os, urllib.request, urllib.error, urllib.parse
base = f"http://127.0.0.1:{os.environ['PORT']}"
def call(method, path, body=None, token=None):
    req = urllib.request.Request(base + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": token} if token else {})})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"  Error: {e.code} {e.read().decode()}")
tok = call("POST", "/api/collections/_superusers/auth-with-password",
           {"identity": os.environ["SU_EMAIL"], "password": os.environ["SU_PASS"]})["token"]
email, pw = os.environ["N_EMAIL"], os.environ["N_PASS"]
flt = urllib.parse.quote(f'email="{email}"')
found = call("GET", f"/api/collections/bakers/records?filter={flt}", token=tok)["items"]
data = {"email": email, "name": os.environ["N_NAME"], "password": pw, "passwordConfirm": pw, "verified": True}
if found:
    call("PATCH", f"/api/collections/bakers/records/{found[0]['id']}", data, tok); print("  Updated Nadia's login.")
else:
    call("POST", "/api/collections/bakers/records", data, tok); print("  Created Nadia's login.")
PY

echo ""
echo "All set! Double-click 'Start Website.command' to run the site."
read -r -p "Press Enter to close."
