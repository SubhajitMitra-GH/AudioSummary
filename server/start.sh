#!/bin/sh
# Start Redis (search module) and Ollama on loopback, then the API on 0.0.0.0:$PORT.
set -e

# The hosted website and the Mac app may call this API from a browser. Keep in sync with
# backend/tests/test_server_mode.py.
export CORS_ORIGIN_REGEX='^(app://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?|https://subhajitmitra-gh\.github\.io)$'

mkdir -p /tmp/redis
# The redis:8 image keeps its modules here; load search explicitly so FT.* always exists.
SEARCH_MODULE="$(ls /usr/local/lib/redis/modules/redisearch.so 2>/dev/null || true)"
redis-server --bind 127.0.0.1 --port "${REDIS_PORT:-6379}" --dir /tmp/redis --save "" --appendonly no \
  --protected-mode yes --daemonize yes --logfile /tmp/redis/redis.log \
  ${SEARCH_MODULE:+--loadmodule "$SEARCH_MODULE"}

OLLAMA_HOST=127.0.0.1:11434 ollama serve >/tmp/ollama.log 2>&1 &

# Warm the model in the background so the first question isn't slow.
(for i in $(seq 1 60); do
   curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break; sleep 1
 done
 curl -s http://127.0.0.1:11434/api/generate -d "{\"model\":\"$LLM_MODEL\",\"prompt\":\"hi\",\"stream\":false}" >/dev/null || true) &

exec python -m app.main
