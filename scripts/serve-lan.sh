#!/usr/bin/env bash
# Let friends on the same Wi-Fi try Tell Me (testing only).
#   1. ./run_all.sh must already be running (backend on 127.0.0.1:8000, Ollama, Redis).
#   2. ./scripts/serve-lan.sh   → prints http://<your IP>:3001 to share.
# Builds a copy of the site whose API base is "/api" (frontend/.lan-site), then serves it with
# scripts/serve-lan.mjs, which forwards /api/* to the backend. Nothing else is opened to the network.
# Over plain http, browsers block the microphone: visitors can upload files, paste links and chat.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then . "$HOME/.nvm/nvm.sh" >/dev/null && nvm use 22 >/dev/null || true; fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "▸ Building the Wi-Fi copy of the site…"
  NEXT_PUBLIC_API_BASE_URL=/api npx next build >/dev/null
  rm -rf .lan-site && cp -R out .lan-site
fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '<your-ip>')"
echo "▸ Share this with people on your Wi-Fi:  http://$IP:${LAN_PORT:-3001}"
exec node "$ROOT/scripts/serve-lan.mjs"
