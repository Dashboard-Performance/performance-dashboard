#!/usr/bin/env bash
# v1.16.0 — sets up the secrets and deploys both Workers in the right order.
# Run from the project folder on your own computer:   bash deploy/setup.sh
# Needs: Node.js 18+, openssl, and a Cloudflare login (the script runs `npx wrangler login` if needed).
# No secret is written to disk or printed except the values you must paste into Apps Script.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
rand() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-"$1"; }
say() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }
ask() { local v; read -r -p "$1 " v; printf '%s' "$v"; }
asks() { local v; read -r -s -p "$1 " v; echo >&2; printf '%s' "$v"; }
put() { printf '%s' "$3" | (cd "$1" && npx --yes wrangler secret put "$2" >/dev/null) && echo "  ✓ $2"; }

command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) is required"; exit 1; }

say "Cloudflare login"
(cd cloudflare-worker && npx --yes wrangler whoami >/dev/null 2>&1) || npx --yes wrangler login

STAFF_SESSION_SECRET="$(rand 48)"
SERVICE_KEY="$(rand 32)"
APPS_SCRIPT_SERVICE_KEY="$(rand 32)"
PORTAL_ADMIN_KEY="$(rand 24)"
PORTAL_SESSION_SECRET="$(rand 48)"

say "Step 1 of 4 — the current ADMIN_KEY of the dashboard Worker"
echo "Paste the ADMIN_KEY you use in the dashboard (Users & Roles → Admin key). Leave empty to create a new one."
DASH_ADMIN_KEY="$(asks 'ADMIN_KEY:')"
NEW_ADMIN=0
if [ -z "$DASH_ADMIN_KEY" ]; then DASH_ADMIN_KEY="$(rand 32)"; NEW_ADMIN=1; fi

say "Step 2 of 4 — Apps Script (do this now, in the browser)"
cat <<EOF
Open the Apps Script project → paste backend/Code.gs → Project Settings → Script Properties, add:

  API_KEYS            = $DASH_ADMIN_KEY
  SERVICE_KEY         = $APPS_SCRIPT_SERVICE_KEY
  WORKER_SERVICE_KEY  = $SERVICE_KEY

Then: Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy.
EOF
[ "$NEW_ADMIN" = 1 ] && echo "(New ADMIN_KEY — save it in your password manager; you type it once per browser in Users & Roles.)"
ask "Press Enter when Apps Script is deployed…" >/dev/null

say "Step 3 of 4 — dashboard Worker secrets + deploy"
[ "$NEW_ADMIN" = 1 ] && put cloudflare-worker ADMIN_KEY "$DASH_ADMIN_KEY"
put cloudflare-worker SERVICE_KEY "$SERVICE_KEY"
put cloudflare-worker APPS_SCRIPT_SERVICE_KEY "$APPS_SCRIPT_SERVICE_KEY"
put cloudflare-worker STAFF_SESSION_SECRET "$STAFF_SESSION_SECRET"
(cd cloudflare-worker && npx --yes wrangler deploy)
echo "Now upload the website files (v1.16.0) the way you always do. Everyone signs in once again."
ask "Press Enter when the website is uploaded…" >/dev/null

say "Step 4 of 4 — merchant portal (new Worker)"
cd "$ROOT/merchant-portal"
if grep -q 'PASTE_THE_KV_NAMESPACE_ID_HERE' wrangler.toml; then
  OUT="$(npx --yes wrangler kv namespace create PORTAL_KV 2>&1 || true)"
  KV_ID="$(printf '%s' "$OUT" | grep -oE '[0-9a-f]{32}' | head -1)"
  [ -n "$KV_ID" ] || { echo "Could not read the KV id from:"; echo "$OUT"; exit 1; }
  sed -i.bak "s/PASTE_THE_KV_NAMESPACE_ID_HERE/$KV_ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  ✓ KV namespace $KV_ID"
fi
MQ="$(ask 'Merchant query link [https://metabase.taager.com/public/question/5761d362-9da0-4f6a-9c83-2d569d8c5f38]:')"
MQ="${MQ:-https://metabase.taager.com/public/question/5761d362-9da0-4f6a-9c83-2d569d8c5f38}"
put . ADMIN_KEY "$PORTAL_ADMIN_KEY"
put . SESSION_SECRET "$PORTAL_SESSION_SECRET"
put . MERCHANT_QUERY_URL "$MQ"
put . DASHBOARD_SERVICE_KEY "$SERVICE_KEY"
RK="$(asks 'Resend API key for emails (optional, Enter to skip):')"
[ -n "$RK" ] && put . RESEND_API_KEY "$RK" && echo "  → also set MAIL_FROM and PORTAL_URL in merchant-portal/wrangler.toml, then redeploy"
npx --yes wrangler deploy

say "Done"
cat <<EOF
Merchant portal admin key (opens https://<portal>/admin):  $PORTAL_ADMIN_KEY
Save it in your password manager — it is not stored anywhere else.

Next, in the browser:
  1) https://<portal>/admin → Refresh now → "Check the column mapping" → Import merchants from the dashboard.
  2) Put the portal address in js/tower.js → MERCHANT_PORTAL_URL, upload the website again.
  3) Metabase: switch public sharing off and on for every question (new links), then:
       cd cloudflare-worker && npx wrangler secret put METABASE_LINKS     # {"gid":"new link", …}
       cd merchant-portal  && npx wrangler secret put MERCHANT_QUERY_URL  # the new merchant-query link
  4) Google Sheets → Share → General access: Restricted.
EOF
