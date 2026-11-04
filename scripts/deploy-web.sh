#!/usr/bin/env bash
# Publish the website to GitHub Pages: https://<owner>.github.io/<repo>/
#   ./scripts/deploy-web.sh
# Builds the static site with a base path of /<repo> (frontend/.env.local supplies the public Supabase keys),
# then force-pushes ONLY the built files to the `gh-pages` branch. Your source branches are not touched.
# The hosted site never contacts the visitor's own computer: signed-in visitors get online mode (their
# backed-up conversations, read from Supabase), and only Macs see "Download for Mac".
# Supabase → Authentication → URL Configuration → Redirect URLs must include https://<owner>.github.io/<repo>/**
# (password-reset links on the website return there).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
NAME="${REPO#*/}"
OWNER="${REPO%%/*}"
SITE_DIR="$ROOT/frontend/.web-site"
cd "$ROOT/frontend"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then . "$HOME/.nvm/nvm.sh" >/dev/null && nvm use 22 >/dev/null || true; fi

echo "▸ Building the website for /$NAME"
# API_URL = the online engine (scripts/deploy-server.sh). Without it the site is a read-only viewer online.
API_URL="${API_URL:-$(cat "$ROOT/server/.api-url" 2>/dev/null || echo http://127.0.0.1:8000)}"
UPLOAD_MB=200; [[ "$API_URL" == https://* ]] && UPLOAD_MB=100 # the online server's MAX_UPLOAD_MB
echo "▸ Engine: $API_URL"
NEXT_PUBLIC_BASE_PATH="/$NAME" NEXT_PUBLIC_API_BASE_URL="$API_URL" NEXT_PUBLIC_MAX_UPLOAD_MB="$UPLOAD_MB" npx next build >/dev/null
rm -rf "$SITE_DIR" && cp -R out "$SITE_DIR"
touch "$SITE_DIR/.nojekyll" # serve the _next/ folder (Jekyll would hide it)
# out/ now has the /<repo> prefix baked in; rebuild it plainly so the Mac app / Electron never picks this up.
npx next build >/dev/null

echo "▸ Pushing the built site to the gh-pages branch"
REMOTE="$(git -C "$ROOT" remote get-url origin)"
cd "$SITE_DIR"
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C "$ROOT" config user.name)" -c user.email="$(git -C "$ROOT" config user.email)" \
  commit -q -m "Deploy website from $(git -C "$ROOT" rev-parse --short HEAD)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q --force "$REMOTE" gh-pages
rm -rf "$SITE_DIR/.git"

echo "▸ Making sure GitHub Pages serves gh-pages"
if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$REPO/pages" -f "source[branch]=gh-pages" -f "source[path]=/" >/dev/null
fi
URL="$(gh api "repos/$REPO/pages" -q .html_url 2>/dev/null || echo "https://$OWNER.github.io/$NAME/")"
echo "▸ Live in a minute or two at: $URL"
