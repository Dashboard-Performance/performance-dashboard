#!/usr/bin/env bash
# v1.17.0 — Command Loop. Upgrade from v1.16.x (secrets stay as they are).
# Run from the project folder:   bash deploy/upgrade-v1.17.sh
# 1) creates the D1 database for the tasks (once) and writes its id into cloudflare-worker/wrangler.toml
# 2) deploys the dashboard Worker, then the merchant portal Worker
set -euo pipefail
cd "$(dirname "$0")/.."
say() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
command -v npx >/dev/null || { echo "Node.js (npx) is required"; exit 1; }
(cd cloudflare-worker && npx --yes wrangler whoami >/dev/null 2>&1) || npx --yes wrangler login

say "Step 1 of 3 — D1 database for the Command Loop tasks"
cd cloudflare-worker
if grep -q 'PASTE-THE-D1-DATABASE-ID-HERE' wrangler.toml; then
  OUT="$(npx --yes wrangler d1 create taager-command-loop 2>&1 || true)"
  ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
  if [ -z "$ID" ]; then
    # already created earlier → read it from the list
    ID="$(npx --yes wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const x=a.find(d=>d.name==="taager-command-loop");process.stdout.write(x?(x.uuid||x.database_id||""):"")}catch(e){}})')"
  fi
  [ -n "$ID" ] || { echo "Could not read the D1 id from:"; echo "$OUT"; exit 1; }
  sed -i.bak "s/PASTE-THE-D1-DATABASE-ID-HERE/$ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  ✓ D1 database $ID"
else
  echo "  ✓ D1 id already in wrangler.toml"
fi
# the tables are created by the Worker itself on first use (CREATE TABLE IF NOT EXISTS)

say "Step 2 of 3 — dashboard Worker"
npx --yes wrangler deploy
cd ..

say "Step 3 of 3 — merchant portal Worker"
(cd merchant-portal && npx --yes wrangler deploy)

say "Done"
cat <<'TXT'
Now upload the website files (v1.17.0) the way you always do.
Then, signed in as Admin / Country Manager:
  Control → Command Loop → Engine → Run now      (first run; after that it runs by itself at 10:00 and 15:00 Cairo)
  Users & Roles → make sure every Account Manager has "Linked ACM account" set (that is how ACM tasks find their owner)
Merchant portal: /admin → Refresh → "Notifications (Command Loop)" once (after that every 30 minutes by itself).
TXT
