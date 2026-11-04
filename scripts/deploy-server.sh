#!/usr/bin/env bash
# Online engine for the website (Windows/phone users): a free Hugging Face Docker Space.
#   ./scripts/deploy-server.sh --local   build the image here and run it on http://127.0.0.1:7860 (test)
#   ./scripts/deploy-server.sh           upload to the Space <hf-user>/tell-me (needs `hf auth login` first)
# Then point the website at it:  API_URL=https://<hf-user>-tell-me.hf.space ./scripts/deploy-web.sh
# The Space gets SUPABASE_URL / SUPABASE_ANON_KEY (public values) from backend/.env as Space variables.
# It uses the same BACKEND_ENCRYPTION_KEY as the Mac app (the built-in default unless backend/.env sets one,
# in which case it is stored as a Space *secret*), so transcripts sync between the two.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPACE_NAME="${SPACE_NAME:-tell-me}"
STAGE="$ROOT/server/.stage"
HF="$ROOT/backend/.venv/bin/hf"
PY="$ROOT/backend/.venv/bin/python"

rm -rf "$STAGE" && mkdir -p "$STAGE"
cp "$ROOT/server/Dockerfile" "$ROOT/server/start.sh" "$ROOT/server/README.md" "$STAGE/"
cp "$ROOT/backend/requirements.txt" "$STAGE/"
rsync -a --exclude __pycache__ "$ROOT/backend/app" "$STAGE/"

env_value() { grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }

if [[ "${1:-}" == "--local" ]]; then
  echo "▸ Building the image locally (first build downloads a few GB)"
  docker build -t tell-me-server "$STAGE"
  docker rm -f tell-me-server >/dev/null 2>&1 || true
  docker run -d --name tell-me-server -p 127.0.0.1:7860:7860 --user 1000:1000 \
    -e SUPABASE_URL="$(env_value SUPABASE_URL)" -e SUPABASE_ANON_KEY="$(env_value SUPABASE_ANON_KEY)" \
    tell-me-server >/dev/null
  echo "▸ Running on http://127.0.0.1:7860 (docker logs -f tell-me-server; stop: docker rm -f tell-me-server)"
  exit 0
fi

USER_NAME="$("$HF" auth whoami 2>/dev/null | grep -iE '^ *user[=:]' | head -1 | sed -E 's/^ *[Uu]ser[=:] *//')"
[[ -n "$USER_NAME" && "$USER_NAME" != *"Not logged in"* ]] || { echo "Log in first:  ! $HF auth login"; exit 1; }
SPACE="$USER_NAME/$SPACE_NAME"

echo "▸ Creating/updating the Space $SPACE"
SUPABASE_URL="$(env_value SUPABASE_URL)" SUPABASE_ANON_KEY="$(env_value SUPABASE_ANON_KEY)" \
BACKEND_KEY="$(env_value BACKEND_ENCRYPTION_KEY)" SPACE="$SPACE" "$PY" - <<'PYEOF'
import os
from huggingface_hub import HfApi
api, space = HfApi(), os.environ["SPACE"]
api.create_repo(space, repo_type="space", space_sdk="docker", exist_ok=True)
api.add_space_variable(space, "SUPABASE_URL", os.environ["SUPABASE_URL"])
api.add_space_variable(space, "SUPABASE_ANON_KEY", os.environ["SUPABASE_ANON_KEY"])
if os.environ.get("BACKEND_KEY"):
    api.add_space_secret(space, "BACKEND_ENCRYPTION_KEY", os.environ["BACKEND_KEY"])
PYEOF
"$HF" upload "$SPACE" "$STAGE" . --repo-type space --commit-message "Deploy Tell Me engine from $(git -C "$ROOT" rev-parse --short HEAD)" >/dev/null
SUB="$(echo "$USER_NAME-$SPACE_NAME" | tr '[:upper:]_.' '[:lower:]--')"
echo "▸ Building on Hugging Face (10–20 min the first time): https://huggingface.co/spaces/$SPACE"
echo "https://$SUB.hf.space" > "$ROOT/server/.api-url" # deploy-web.sh points the website here
echo "▸ API URL once running: https://$SUB.hf.space"
