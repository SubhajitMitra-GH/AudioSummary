#!/bin/bash

# Store active process IDs to clean them up on exit
pids=()

cleanup() {
    echo -e "\n\033[1;31mStopping all services...\033[0m"
    for pid in "${pids[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    echo -e "\033[1;32mCleanup complete. Goodbye!\033[0m"
}

# Trap Ctrl+C (SIGINT) and exit signals to run cleanup
trap cleanup EXIT SIGINT SIGTERM

echo -e "\033[1;34mStarting AudioSummary Services...\033[0m"

# 1. Start Redis Stack Server (Local Cache & Vector Store)
echo -e "\033[1;36m[1/4] Starting Redis Stack Server...\033[0m"
if command -v redis-stack-server >/dev/null 2>&1; then
    # redis-stack-server disables protected mode, so restrict it to this computer explicitly.
    redis-stack-server --bind 127.0.0.1 > /dev/null 2>&1 &
    redis_pid=$!
    pids+=($redis_pid)
    sleep 2
else
    echo -e "\033[1;31m[Error] redis-stack-server is not installed or not in PATH.\033[0m"
    exit 1
fi

# 2. Start Ollama Server
echo -e "\033[1;36m[2/4] Starting Ollama Server...\033[0m"
if command -v ollama >/dev/null 2>&1; then
    ollama serve > /dev/null 2>&1 &
    ollama_pid=$!
    pids+=($ollama_pid)
    sleep 2
else
    echo -e "\033[1;33m[Warning] Ollama is not installed. Skipping Ollama start.\033[0m"
fi

# 3. Start Python Backend
echo -e "\033[1;36m[3/4] Starting FastAPI Python Backend...\033[0m"
# Free port 8000 if occupied
# Only match the process LISTENING on 8000. A plain `lsof -i :8000` also matches clients
# connected to it (e.g. the browser tab polling /health) and would kill them.
if lsof -nP -iTCP:8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "\033[1;33m[Warning] Port 8000 is occupied. Freeing port...\033[0m"
    lsof -nP -iTCP:8000 -sTCP:LISTEN -t | xargs kill -9 2>/dev/null || true
    sleep 1
fi
cd backend
source .venv/bin/activate
python -m app.main &
backend_pid=$!
pids+=($backend_pid)
cd ..

# 4. Start Next.js Frontend
echo -e "\033[1;36m[4/4] Starting Next.js Frontend...\033[0m"
cd frontend
if [ -f "$HOME/.nvm/nvm.sh" ]; then
    source "$HOME/.nvm/nvm.sh"
    nvm use 22 > /dev/null 2>&1 || true
fi
npm run dev &
frontend_pid=$!
pids+=($frontend_pid)
cd ..

echo -e "\033[1;32m🚀 All services are up and running!\033[0m"
echo -e "Press \033[1;33mCtrl+C\033[0m to stop all services simultaneously."

# Wait for background processes to keep running
wait
