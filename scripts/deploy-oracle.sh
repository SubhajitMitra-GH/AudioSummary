#!/usr/bin/env bash
# Online engine on an Oracle Cloud Always Free VM (Ampere A1, Ubuntu).
#   ./scripts/deploy-oracle.sh <public-ip>
# Copies the engine (server/ + backend/app) to the VM over SSH (key ~/.ssh/tellme_oracle), builds and runs it
# there behind HTTPS at https://<ip-with-dashes>.sslip.io, and saves that URL to server/.api-url so
# ./scripts/deploy-web.sh points the website at it. Re-run after backend changes to update the server.
set -euo pipefail
IP="${1:?usage: deploy-oracle.sh <public-ip>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="$HOME/.ssh/tellme_oracle"
HOST="ubuntu@$IP"
DOMAIN="$(echo "$IP" | tr . -).sslip.io"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$HOST")
env_value() { grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

STAGE="$ROOT/server/.stage"
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp "$ROOT/server/Dockerfile" "$ROOT/server/start.sh" "$ROOT/server/vm-setup.sh" "$ROOT/backend/requirements.txt" "$STAGE/"
rsync -a --exclude __pycache__ "$ROOT/backend/app" "$STAGE/"

echo "▸ Copying the engine to $IP"
"${SSH[@]}" "mkdir -p ~/tell-me"
rsync -az --delete -e "ssh -i $KEY -o StrictHostKeyChecking=accept-new" "$STAGE/" "$HOST:tell-me/"

echo "▸ Setting up the server (Docker, firewall, HTTPS)"
"${SSH[@]}" "DOMAIN='$DOMAIN' SUPABASE_URL='$(env_value SUPABASE_URL)' SUPABASE_ANON_KEY='$(env_value SUPABASE_ANON_KEY)' \
  LLM_MODEL='${LLM_MODEL:-llama3.2:3b}' BACKEND_ENCRYPTION_KEY='$(env_value BACKEND_ENCRYPTION_KEY)' bash tell-me/vm-setup.sh"

echo "https://$DOMAIN" > "$ROOT/server/.api-url"
echo "▸ Waiting for the engine to answer"
for i in $(seq 1 60); do
  if curl -sf "https://$DOMAIN/health" | grep -q healthy; then echo "▸ Ready: https://$DOMAIN"; exit 0; fi
  sleep 5
done
echo "Not answering yet. Check: ssh -i $KEY $HOST 'sudo docker logs --tail 50 tell-me-server; sudo docker logs --tail 20 caddy'"
exit 1
