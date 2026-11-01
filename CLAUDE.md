# CLAUDE.md

"Tell Me." — a local-first audio RAG desktop app (macOS). Users record/upload audio or paste a YouTube/direct link → local Whisper transcription → chunk + embed → Redis vector search → answers from a local Ollama LLM. Supabase provides auth and a cloud backup of sessions/messages/chunks.

## Architecture

```
Electron (frontend/electron.js)
 ├─ spawns redis-server 127.0.0.1:6379 and backend-service (PyInstaller build of FastAPI)
 └─ loads app://index.html  (Next.js static export in frontend/out)
        │ apiFetch → http://127.0.0.1:8000  (Authorization: Bearer <Supabase access token>)
        ▼
FastAPI (backend/app/main.py) — the ONLY path for app data
 ├─ auth.py          → JWT verified by signature against Supabase JWKS (cached in memory + Redis);
 │                     falls back to Supabase /auth/v1/user online for HS256 projects; never trusts unsigned tokens
 ├─ auth.py          → verify_session_ownership: Redis owner first, then Supabase with the USER's token (RLS)
 ├─ audio_processor  → faster-whisper "base", CPU, int8
 ├─ rag_pipeline     → chunk (1000/150) → all-MiniLM-L6-v2 (384-d) → Redis HNSW → Ollama
 ├─ redis_client     → local cache + vector index + offline "synced=False" queue (SCAN, auto-reconnect)
 ├─ url_processor    → yt-dlp or direct download; public addresses only, size-capped
 └─ supabase_rest    → PostgREST URL/header helpers (always the user's token)
```

- Writes are local-first: save to Redis with `synced=False`, then best-effort call to Supabase, then mark synced. Reads merge cloud rows into Redis.
- Offline queue is flushed by `POST /sync` (`sync_user_data`), which the frontend calls on login and on the browser `online` event. There is no background worker or job queue.
- The frontend uses `supabase-js` **only for auth**. All data goes through the backend via `src/utils/api.ts` (`apiFetch` adds the token).
- Startup gates in `frontend/src/app/page.tsx`: `/health` healthy → Supabase session (else `LandingPage`) → `/ollama/status` (else `OllamaSetupWizard`, which needs the user to be signed in) → main UI.

## Tech stack

- **Frontend:** Next.js 16.2.9 (`output: "export"`), React 19.2.4, TypeScript (strict), Tailwind CSS v4, lucide-react, crypto-js, @supabase/supabase-js. Electron ^43 + electron-builder (mac zip).
- **Backend:** Python ≥3.10, FastAPI, uvicorn, pydantic-settings, PyJWT[crypto], requests, python-dateutil, faster-whisper, sentence-transformers, langchain-text-splitters, langchain-community (`Ollama` LLM), redis-py, cryptography (Fernet), yt-dlp.
- **Services:** Redis with the search module (Redis Stack or Redis 8+), Ollama on :11434 (default model `mistral`), Supabase (Auth + Postgres), ffmpeg (yt-dlp audio extraction).

## Important directories

```
run_all.sh                     dev launcher for all four services
backend/app/main.py            routes, sync, Ollama installer
backend/app/auth.py            token verification, session-id validation, ownership checks
backend/app/config.py          Settings (reads backend/.env relative to CWD)
backend/app/rag_pipeline.py    Fernet helpers, ingest, retrieval, prompt, Ollama call
backend/app/redis_client.py    Redis key layout, vector index, unsynced fetchers
backend/app/url_processor.py   link downloads + IngestError (user-facing messages)
backend/tests/                 pytest suite (heavy ML libs are stubbed in conftest.py)
frontend/electron.js           main process, app:// protocol, sidecar spawning
frontend/src/app/page.tsx      top-level controller: state + startup gates + chat/session actions
frontend/src/components/       AudioRecorder, ChatInterface, Sidebar, Auth, LandingPage, OllamaSetupWizard
frontend/src/utils/            api.ts (API_BASE, apiFetch), crypto.ts (CryptoJS AES), supabase.ts (client + types)
supabase/rls_policies.sql      owner-only RLS policies (review, then run in the Supabase SQL editor)
```

## Commands

Dev (everything): `./run_all.sh` — needs `redis-stack-server` on PATH, `backend/.venv`, Node 22 (via nvm if present); Ollama optional. **It kills whatever is on port 8000.**

Backend (must run from `backend/` so `.env` is found; copy `.env.example` → `.env`):
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # requirements.txt + pytest/httpx/fakeredis
python -m app.main                    # uvicorn on 127.0.0.1:8000
python -m pytest                      # tests; no Redis, network or ML models needed
```

Frontend (`cd frontend`; copy `.env.example` → `.env.local`):
```bash
npm install
npm run dev            # next dev on :3000
npm run lint           # eslint (4 known pre-existing react-hooks/set-state-in-effect errors in page.tsx)
npx tsc --noEmit       # type check
npm run build          # static export → frontend/out
npm run electron       # dev Electron: loads localhost:3000, expects ../backend/dist/backend-service/backend-service
npm run build:desktop  # next build + electron-builder --mac
```

There are no frontend tests and no CI yet.

Desktop packaging needs `backend/dist/backend-service/` built with PyInstaller (the `.spec` is gitignored and not in the repo) and `backend/desktop.env`, which is copied into the app as its `.env`. **Everything in `desktop.env` is readable by anyone who installs the app** — never put a service-role key or JWT secret there.

## Configuration

`backend/.env` (see `backend/.env.example`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BACKEND_ENCRYPTION_KEY`, `REDIS_HOST/PORT/DB/PASSWORD`, `HOST` (keep `127.0.0.1`), `PORT`, `LLM_MODEL`, `MAX_UPLOAD_MB` (default 200), `CORS_ORIGIN_REGEX` (default: `app://` + localhost).
Frontend (see `frontend/.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_ALE_KEY`, `NEXT_PUBLIC_API_BASE_URL`. `MAX_UPLOAD_MB` in `api.ts` must match the backend.

## API (backend/app/main.py)

All session-scoped routes validate the session id as a UUID and call `verify_session_ownership`.

| Route | Auth | Notes |
|---|---|---|
| `GET /health` | – | `healthy` only if Redis pings |
| `GET /ollama/status`, `GET /ollama/install/status` | – | read-only |
| `POST /ollama/install`, `POST /ollama/pull` | JWT | install is macOS-only (ditto + codesign verify); pull streams NDJSON |
| `POST /sync` | JWT | flush offline queue |
| `GET /sessions`, `POST /sessions` | JWT | POST on an existing id returns it unchanged (never resets `created_at`) |
| `PATCH /sessions/{id}` | JWT + owner | rename (`session_title`) |
| `DELETE /sessions/{id}` | JWT + owner | tombstone, local delete, cloud delete |
| `GET /sessions/{id}/messages`, `POST /messages` | JWT + owner | `sender` must be `user` or `assistant` |
| `POST /upload` (multipart `file`, `session_id`) | JWT + owner/new | .wav .mp3 .m4a .ogg .flac .webm, ≤ MAX_UPLOAD_MB |
| `POST /upload-link` (`url`, `session_id`) | JWT + owner/new | 422 with a readable message on IngestError |
| `POST /chat` (`question`, `audio_id` required) | JWT + owner | returns `{answer, context}` |

Ingestion order: the client generates the session UUID, calls `/upload` or `/upload-link` **first**, then `POST /sessions`, then posts an intro assistant message.

## Data model

Supabase (no migrations in repo; inferred from code): `sessions(id, user_id, session_title, created_at)`, `chat_messages(id, session_id, sender, message_text, created_at)`, `document_chunks(session_id, chunk_index, content, embedding, user_id)`. Deletes go chunks → messages → session.

Redis keys (`redis_client.py`):
- `session:{id}` hash · `user_sessions:{uid}` set
- `message:{id}` hash · `session_messages:{sid}` zset (score = server time)
- `chunk:{sid}:{idx}` hash, `embedding` as raw float32 bytes; new sources continue numbering after existing chunks · index `vector_idx` on prefix `chunk:` (Tag `session_id`/`user_id`, Text `content`, HNSW FLOAT32 384 COSINE)
- `deleted_session:{sid}` = uid (delete tombstone) · `supabase:jwks` (cached signing keys)
- All hashes use string `"True"`/`"False"` for `synced`.

Encryption (two schemes, both with keys shared by every user of an install — not end-to-end):
- Frontend `encryptText`/`decryptText` (CryptoJS AES, `NEXT_PUBLIC_ALE_KEY`) → `session_title`, `message_text`. The backend never decrypts these.
- Backend Fernet (SHA-256 of `BACKEND_ENCRYPTION_KEY`) → `document_chunks.content`. Embeddings are stored unencrypted.

## Conventions

- Backend routes are plain `def` (they do blocking work and run in FastAPI's threadpool). Don't make them `async def` unless everything inside is non-blocking.
- Supabase calls: `rest_url(table)` + `user_headers(token, ...)`; never use the anon key alone to read user data.
- Errors to clients are generic; log details with `logger.exception`. User-facing ingestion errors use `IngestError`. Don't log question/transcript text.
- Module-level singletons: `settings`, `audio_processor`, `rag_pipeline`, `redis_client`, `jwks_cache`. Logger: `logging.getLogger("uvicorn.error")`.
- Frontend: client components (`'use client'`), all backend calls through `apiFetch`/`API_BASE`, styling via Tailwind + CSS variables in `globals.css`, theme via `data-theme` on `<html>` persisted in `localStorage['theme']`.
- This Next.js version has breaking changes — read `frontend/node_modules/next/dist/docs/` before using Next APIs (see `frontend/AGENTS.md`).
- Add a backend test in `backend/tests/` for every behaviour change; tests must not need network or models.

## Constraints / do not break

- **Static export:** no API routes, server actions, middleware, or server-only data fetching in the frontend.
- **Encryption keys:** changing `NEXT_PUBLIC_ALE_KEY` or `BACKEND_ENCRYPTION_KEY` makes existing data unreadable.
- **Vector index:** dim 384 is tied to `all-MiniLM-L6-v2`; the `chunk:` prefix and field names are coupled across `save_chunk`, `get_unsynced_chunks`, `retrieve_context` and `create_vector_index` (which rebuilds the index if `session_id`/`user_id` fields are missing). Retrieval must always filter by both `user_id` and `session_id`.
- **Redis key names and `synced` string flags** are relied on by the sync logic.
- **Network exposure:** backend and Redis bind to `127.0.0.1`; CORS is limited to `app://` and localhost. Keep it that way.
- **Electron paths:** backend binary at `backend-service/backend-service`; Redis data dir `~/Library/Application Support/Tell Me`; ports 8000/6379/11434 are hard-coded in several places.
- **PyInstaller:** keep `uvicorn.run(app, ...)` with no reload/string import in `main.py`'s `__main__`.

## Known limitations

- Offline auth needs the Supabase project to use asymmetric JWT signing keys (JWKS). Legacy HS256 projects can only verify online. Access tokens expire (~1 h) and can't refresh offline.
- Encryption keys are shared per install (see above); per-user keys would be needed for real end-to-end privacy.
- Long ingestions run inside one HTTP request with no progress reporting.
- `main.py` and `page.tsx` are still large; Python dependencies are not pinned; no CI.
