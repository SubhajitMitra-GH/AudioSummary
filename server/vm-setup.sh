#!/usr/bin/env bash
# Runs ON the Oracle Cloud VM (Ubuntu, arm64), from scripts/deploy-oracle.sh. Safe to re-run.
# Installs Docker, opens ports 80/443, builds the engine image and runs it behind Caddy (automatic HTTPS
# for $DOMAIN, an <ip>.sslip.io name, so no domain purchase is needed).
set -euo pipefail
: "${DOMAIN:?}" "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${LLM_MODEL:=llama3.2:3b}"
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  echo "▸ Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh >/dev/null
fi

# Oracle's Ubuntu images reject everything but SSH in iptables (on top of the cloud security list).
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    n="$(sudo iptables -L INPUT --line-numbers | awk '/REJECT/ {print $1; exit}')"
    if [[ -n "$n" ]]; then sudo iptables -I INPUT "$n" -p tcp --dport "$port" -j ACCEPT
    else sudo iptables -A INPUT -p tcp --dport "$port" -j ACCEPT; fi
  fi
done
sudo sh -c 'command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true'

echo "▸ Building the engine image (first time: ~10–15 min)"
sudo docker build -q --build-arg LLM_MODEL="$LLM_MODEL" -t tell-me-server . >/dev/null
sudo docker image prune -f >/dev/null

sudo docker network create tellme >/dev/null 2>&1 || true
sudo docker rm -f tell-me-server >/dev/null 2>&1 || true
sudo docker run -d --name tell-me-server --restart unless-stopped --network tellme \
  -e SUPABASE_URL -e SUPABASE_ANON_KEY -e LLM_MODEL \
  ${BACKEND_ENCRYPTION_KEY:+-e BACKEND_ENCRYPTION_KEY} \
  tell-me-server >/dev/null

cat > Caddyfile <<EOF
$DOMAIN {
	request_body {
		max_size 110MB
	}
	reverse_proxy tell-me-server:7860 {
		flush_interval -1
	}
}
EOF
sudo docker rm -f caddy >/dev/null 2>&1 || true
sudo docker run -d --name caddy --restart unless-stopped --network tellme -p 80:80 -p 443:443 \
  -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -v caddy_data:/data caddy:2.8-alpine >/dev/null
echo "▸ Engine running at https://$DOMAIN"
