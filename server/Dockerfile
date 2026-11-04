# Tell Me. online engine: FastAPI backend + Redis (with search) + Ollama + Whisper in one container,
# for a free Hugging Face Docker Space (2 vCPU, 16 GB RAM). Built by scripts/deploy-server.sh, which
# copies backend/app and backend/requirements.txt next to this file.
FROM ollama/ollama:latest AS ollama
# CPU-only server: drop the GPU (CUDA/ROCm/Vulkan) runtimes, several GB the Space can't use.
RUN find /usr/lib/ollama -mindepth 1 -maxdepth 1 -type d -exec rm -rf {} + && ls /usr/lib/ollama

# Redis 8 ships the search module (FT.*) that the vector index needs.
FROM redis:8.2-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ollama /usr/bin/ollama /usr/bin/ollama
COPY --from=ollama /usr/lib/ollama /usr/lib/ollama

ENV VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/opt/hf \
    OLLAMA_MODELS=/opt/ollama-models \
    PIP_NO_CACHE_DIR=1

# CPU-only PyTorch first (the default wheel bundles GBs of CUDA we can't use).
RUN python3 -m venv /opt/venv \
 && pip install --upgrade pip \
 && pip install torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

# Bake the speech and embedding models into the image (the Space's disk is wiped on restart).
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8')" \
 && python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2', device='cpu')"

# Bake the answer model. Fast (1B) keeps answers usable on 2 shared CPUs.
ARG LLM_MODEL=llama3.2:1b
RUN (OLLAMA_HOST=127.0.0.1:11434 ollama serve >/tmp/ollama-build.log 2>&1 &) \
 && for i in $(seq 1 60); do ollama list >/dev/null 2>&1 && break; sleep 1; done \
 && ollama pull "$LLM_MODEL" \
 && chmod -R a+rX /opt/ollama-models   # only this RUN's files: re-chmodding all of /opt would copy ~3 GB into a new layer

COPY app /app/app
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

WORKDIR /app
# Spaces run the container as uid 1000 with a writable /tmp; keep every runtime write there.
ENV HOME=/tmp \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    LLM_MODEL=$LLM_MODEL \
    SERVER_MODE=true \
    HOST=0.0.0.0 \
    PORT=7860 \
    REDIS_HOST=127.0.0.1 \
    REDIS_PORT=6379 \
    MAX_UPLOAD_MB=100 \
    OLLAMA_KEEP_ALIVE=24h
EXPOSE 7860
CMD ["/app/start.sh"]
