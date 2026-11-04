import os
import sys
import json
import time
import shutil
import logging
import tempfile
import threading
import subprocess
from contextlib import asynccontextmanager
from typing import List, Literal

import requests
from fastapi import FastAPI, UploadFile, File, HTTPException, status, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.config import settings
from app.auth import get_current_user, validate_session_id, verify_session_ownership
from app.audio_processor import audio_processor
from app.llm_models import available_models, describe, get_active_model, is_installed, is_known_model, set_active_model
from app.rag_pipeline import rag_pipeline
from app.redis_client import redis_client
from app.supabase_rest import rest_url, user_headers
from app.url_processor import IngestError, download_audio_from_url

logger = logging.getLogger("uvicorn.error")

# NOTE: routes are plain `def` on purpose. They call blocking code (Whisper, embeddings, Ollama,
# Redis, `requests`); FastAPI runs `def` routes in a thread pool, so one long transcription no
# longer freezes every other request.

ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}
OLLAMA_URL = "http://127.0.0.1:11434"
OLLAMA_DOWNLOAD_URL = "https://ollama.com/download/Ollama-darwin.zip"


def utc_now_iso() -> str:
    return time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())


def sync_user_data(user_id: str, token: str):
    """Flushes unsynced local Redis sessions, messages, chunks and deletions to Supabase for this user."""
    if not redis_client.client:
        return

    try:
        unsynced_sessions = [s for s in redis_client.get_unsynced_sessions() if s.get("user_id") == user_id]

        user_session_ids = {
            sid for sid in redis_client.client.smembers(f"user_sessions:{user_id}")
        }
        unsynced_messages = [m for m in redis_client.get_unsynced_messages() if m["session_id"] in user_session_ids]
        unsynced_chunks = [c for c in redis_client.get_unsynced_chunks() if c.get("user_id") == user_id]
        pending_deletions = redis_client.get_deletion_tombstones(user_id)

        if not (unsynced_sessions or unsynced_messages or unsynced_chunks or pending_deletions):
            return

        logger.info(f"Sync task: Flushing offline queue to Supabase for user {user_id}... "
                    f"(sessions: {len(unsynced_sessions)}, messages: {len(unsynced_messages)}, "
                    f"chunks: {len(unsynced_chunks)}, deletions: {len(pending_deletions)})")

        # 1. Sessions (upsert, so renames of already-synced sessions are applied too)
        for sess in unsynced_sessions:
            payload = {
                "id": sess["id"],
                "user_id": sess["user_id"],
                "session_title": sess["session_title"],
                "created_at": sess["created_at"]
            }
            res = requests.post(rest_url("sessions"), json=payload,
                                headers=user_headers(token, json_body=True, prefer="resolution=merge-duplicates"),
                                timeout=5)
            if res.status_code in (200, 201):
                redis_client.mark_session_synced(sess["id"])

        # 2. Messages
        for msg in unsynced_messages:
            payload = {k: msg[k] for k in ("id", "session_id", "sender", "message_text", "created_at")}
            res = requests.post(rest_url("chat_messages"), json=payload,
                                headers=user_headers(token, json_body=True, prefer="resolution=merge-duplicates"),
                                timeout=5)
            if res.status_code in (200, 201):
                redis_client.mark_message_synced(msg["id"])

        # 3. Chunks, one request per session
        by_session: dict[str, list] = {}
        for chunk in unsynced_chunks:
            by_session.setdefault(chunk["session_id"], []).append(chunk)
        for session_id, chunks in by_session.items():
            rows = [{k: c[k] for k in ("session_id", "chunk_index", "content", "embedding", "user_id")} for c in chunks]
            res = requests.post(rest_url("document_chunks"), json=rows,
                                headers=user_headers(token, json_body=True, prefer="return=minimal"),
                                timeout=15)
            if res.status_code in (200, 201):
                for c in chunks:
                    redis_client.mark_chunk_synced(c["redis_key"])
            else:
                logger.warning(f"Chunk sync for session {session_id} failed: status {res.status_code}")

        # 4. Deletions
        for session_id in pending_deletions:
            if delete_session_in_cloud(session_id, token):
                redis_client.client.delete(f"deleted_session:{session_id}")
                logger.info(f"Synced deletion of session {session_id} to Supabase.")
    except Exception:
        logger.exception("Sync error during data flush")


def delete_session_in_cloud(session_id: str, token: str) -> bool:
    """Delete a session and its children in Supabase. Children first to satisfy foreign keys."""
    headers = user_headers(token)
    requests.delete(rest_url("document_chunks"), params={"session_id": f"eq.{session_id}"}, headers=headers, timeout=5)
    requests.delete(rest_url("chat_messages"), params={"session_id": f"eq.{session_id}"}, headers=headers, timeout=5)
    res = requests.delete(rest_url("sessions"), params={"id": f"eq.{session_id}"}, headers=headers, timeout=5)
    return res.status_code in (200, 204)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to local Redis Stack and load Whisper
    redis_client.connect()
    if settings.using_default_encryption_key:
        logger.warning(
            "BACKEND_ENCRYPTION_KEY is not set: transcript chunks are encrypted with the public "
            "built-in default key, which offers no real protection. Set it in backend/.env."
        )
    try:
        audio_processor.load_model(model_size="base")
    except Exception as e:
        logger.error(f"Startup warning: Whisper model could not be loaded: {e}")

    yield
    # Shutdown: disconnect Redis client
    redis_client.disconnect()


app = FastAPI(
    title="Audio Summarization RAG Backend",
    description="Backend API for Audio Summarization RAG pipeline",
    version="0.2.0",
    lifespan=lifespan
)

# Only the desktop app (app://) and the local dev server may call this API from a browser.
# Auth uses the Authorization header, not cookies, so credentials are not needed.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateSessionRequest(BaseModel):
    id: str
    session_title: str


class RenameSessionRequest(BaseModel):
    session_title: str


class CreateMessageRequest(BaseModel):
    id: str
    session_id: str
    sender: Literal["user", "assistant"]
    message_text: str
    created_at: str


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1, description="The user's question about the audio recording")
    audio_id: str = Field(..., description="The session ID whose audio should be searched")


class LinkRequest(BaseModel):
    url: str = Field(..., min_length=1, description="YouTube or direct audio file URL")
    session_id: str = Field(..., description="Unique session ID for indexing")


@app.get("/health", status_code=200)
def health_check():
    redis_alive = redis_client.ping()
    # On the shared server the AI model is part of the service: report ready only once Ollama answers too.
    ready = redis_alive and (not settings.server_mode or ollama_installed_models() is not None)
    return {
        "status": "healthy" if ready else "degraded",
        "redis_connected": redis_alive,
        "service": "Audio Summarization RAG API"
    }


# --- OLLAMA SETUP ---

# Global status tracking for Ollama auto-installer
ollama_install_progress = {"status": "idle", "progress": 0}
_install_lock = threading.Lock()


def _set_install(status_: str, progress: int):
    ollama_install_progress["status"] = status_
    ollama_install_progress["progress"] = progress


OLLAMA_APP_PATHS = ("/Applications/Ollama.app", os.path.expanduser("~/Applications/Ollama.app"))
OLLAMA_CLI_PATHS = ("/opt/homebrew/bin/ollama", "/usr/local/bin/ollama")


def _ollama_answering() -> bool:
    try:
        return requests.get(f"{OLLAMA_URL}/api/tags", timeout=2).status_code == 200
    except requests.RequestException:
        return False


def _wait_for_ollama(seconds: int) -> bool:
    for _ in range(seconds):
        if _ollama_answering():
            return True
        time.sleep(1)
    return False


def start_existing_ollama() -> bool:
    """If Ollama is already installed (app or Homebrew CLI) but not running, start it instead of downloading."""
    app_path = next((p for p in OLLAMA_APP_PATHS if os.path.isdir(p)), None)
    if app_path:
        logger.info("Ollama.app is installed; launching it.")
        subprocess.Popen(["open", app_path])
        return _wait_for_ollama(30)
    cli = next((p for p in OLLAMA_CLI_PATHS if os.path.isfile(p) and os.access(p, os.X_OK)), None)
    if cli:
        logger.info("Ollama CLI is installed; starting `ollama serve`.")
        # Own session: keeps running independently of this request (and of the app restarting).
        subprocess.Popen([cli, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return _wait_for_ollama(30)
    return False


def download_and_install_ollama_bg():
    """Start an installed Ollama, or download it, verify its code signature, copy it to /Applications and launch it (macOS)."""
    try:
        _set_install("starting", 5)
        if start_existing_ollama():
            _set_install("completed", 100)
            logger.info("Started the Ollama that was already installed.")
            return
        with tempfile.TemporaryDirectory(prefix="ollama-install-") as tmp:
            zip_path = os.path.join(tmp, "Ollama-darwin.zip")
            logger.info("Starting Ollama app download...")
            with requests.get(OLLAMA_DOWNLOAD_URL, stream=True, timeout=30) as res:
                res.raise_for_status()
                total = int(res.headers.get("Content-Length", 0))
                done = 0
                with open(zip_path, "wb") as f:
                    for block in res.iter_content(chunk_size=1024 * 256):
                        f.write(block)
                        done += len(block)
                        if total:
                            _set_install("downloading", min(89, int(done * 90 / total)))

            _set_install("extracting", 90)
            extract_dir = os.path.join(tmp, "extracted")
            # `ditto` keeps executable permissions and symlinks; Python's zipfile drops them,
            # which leaves an app bundle that cannot launch.
            subprocess.run(["ditto", "-x", "-k", zip_path, extract_dir], check=True, capture_output=True)
            app_path = os.path.join(extract_dir, "Ollama.app")
            if not os.path.isdir(app_path):
                raise RuntimeError("Ollama.app was not found in the downloaded archive.")

            # Refuse to install anything whose code signature is missing or broken.
            subprocess.run(["codesign", "--verify", "--deep", "--strict", app_path], check=True, capture_output=True)

            target = "/Applications/Ollama.app"
            if os.path.exists(target):
                shutil.rmtree(target)
            subprocess.run(["ditto", app_path, target], check=True, capture_output=True)

        _set_install("starting", 95)
        logger.info("Launching Ollama.app...")
        subprocess.Popen(["open", "-a", "Ollama"])

        for _ in range(30):
            time.sleep(1)
            try:
                if requests.get(f"{OLLAMA_URL}/api/tags", timeout=2).status_code == 200:
                    _set_install("completed", 100)
                    logger.info("Ollama is installed, launched, and listening.")
                    return
            except requests.RequestException:
                pass
        # Installed and launched, but not answering yet. The UI re-checks status.
        _set_install("launched", 100)
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to install Ollama ({e.cmd[0]}): {e.stderr!r}")
        _set_install("error: Installation failed while extracting or verifying the Ollama app.", 0)
    except Exception as e:
        logger.exception("Failed to install Ollama")
        _set_install(f"error: {e}", 0)


def ollama_installed_models() -> list[str] | None:
    """Names of models downloaded in Ollama, or None if Ollama isn't running."""
    try:
        res = requests.get(f"{OLLAMA_URL}/api/tags", timeout=2)
        if res.status_code == 200:
            return [m.get("name", "") for m in res.json().get("models", [])]
    except (requests.RequestException, ValueError):
        pass
    return None


@app.get("/ollama/status")
def get_ollama_status():
    installed = ollama_installed_models()
    active = get_active_model()
    return {
        "ollama_running": installed is not None,
        "model_pulled": installed is not None and is_installed(active, installed),
        "configured_model": active
    }


class SelectModelRequest(BaseModel):
    model: str


def _models_response() -> dict:
    installed = ollama_installed_models()
    active = get_active_model()
    models = [describe(m, active, installed) for m in available_models()]
    if settings.server_mode:
        models = [m for m in models if m["active"]]  # the server runs one fixed model
    return {
        "active": active,
        "ollama_running": installed is not None,
        "server_mode": settings.server_mode,
        "models": models,
    }


def _refuse_on_server():
    if settings.server_mode:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="The online server uses a fixed AI model. Choose models in the Mac app.")


@app.get("/models")
def list_models():
    """The AI models users can choose from, which are downloaded, and which is in use."""
    return _models_response()


@app.put("/models/active")
def select_model(request: SelectModelRequest, credentials: dict = Depends(get_current_user)):
    _refuse_on_server()
    if not is_known_model(request.model):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown model.")
    set_active_model(request.model)
    logger.info(f"Active AI model set to '{request.model}'.")
    return _models_response()


@app.post("/ollama/install")
def trigger_ollama_install(credentials: dict = Depends(get_current_user)):
    _refuse_on_server()
    if sys.platform != "darwin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Automatic installation is only available on macOS. Install Ollama from ollama.com.")
    with _install_lock:
        if ollama_install_progress["status"] in ("downloading", "extracting", "starting"):
            return {"message": "Installation already in progress.", "status": ollama_install_progress}
        _set_install("downloading", 0)
        threading.Thread(target=download_and_install_ollama_bg, daemon=True).start()
    return {"message": "Ollama installation triggered.", "status": ollama_install_progress}


@app.get("/ollama/install/status")
def get_ollama_install_status():
    return ollama_install_progress


@app.post("/ollama/pull")
def pull_ollama_model(credentials: dict = Depends(get_current_user)):
    _refuse_on_server()
    def generate():
        try:
            with requests.post(f"{OLLAMA_URL}/api/pull", json={"name": get_active_model()},
                               stream=True, timeout=(5, 3600)) as res:
                if res.status_code != 200:
                    yield json.dumps({"status": "error", "message": f"Ollama returned HTTP {res.status_code}"}) + "\n"
                    return
                for line in res.iter_lines():
                    if line:
                        yield line.decode("utf-8") + "\n"
        except requests.RequestException as e:
            logger.error(f"Model pull failed: {e}")
            yield json.dumps({"status": "error", "message": "Could not reach Ollama to download the model."}) + "\n"
    return StreamingResponse(generate(), media_type="application/x-ndjson")


# --- EVENT-DRIVEN SYNC TRIGGER ENDPOINT ---

@app.post("/sync", status_code=200)
def trigger_reconnect_sync(credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    sync_user_data(user_id, credentials["token"])
    return {"status": "completed", "user_id": user_id}


# --- SESSIONS ---

@app.get("/sessions", response_model=List[dict])
def get_sessions(credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]

    # 1. Fetch from local Redis Cache
    local_sessions = redis_client.get_user_sessions(user_id)

    # 2. Try fetching from Supabase to sync/merge
    try:
        res = requests.get(rest_url("sessions"), headers=user_headers(token),
                           params={"user_id": f"eq.{user_id}", "order": "created_at.desc"}, timeout=5)
        if res.status_code == 200:
            local_ids = {s["id"] for s in local_sessions}
            tombstoned = set(redis_client.get_deletion_tombstones(user_id))
            for cs in res.json():
                if cs["id"] not in local_ids and cs["id"] not in tombstoned:
                    redis_client.save_session(
                        session_id=cs["id"],
                        user_id=user_id,
                        title=cs["session_title"],
                        created_at=cs["created_at"],
                        synced=True
                    )
            # Re-fetch local cache after merging
            local_sessions = redis_client.get_user_sessions(user_id)
    except requests.RequestException as e:
        logger.warning(f"Could not fetch sessions from Supabase: {e}. Falling back to local cache.")

    return local_sessions


@app.post("/sessions", response_model=dict)
def create_session(request: CreateSessionRequest, credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    session_id = validate_session_id(request.id)
    verify_session_ownership(session_id, user_id, token, allow_new=True)

    existing = redis_client.get_session(session_id)
    if existing:
        # Creating an existing session must not reset its date. Use PATCH to rename.
        return {"id": session_id, "session_title": existing["session_title"], "user_id": user_id,
                "created_at": existing["created_at"]}

    created_at = utc_now_iso()
    redis_client.save_session(session_id=session_id, user_id=user_id, title=request.session_title,
                              created_at=created_at, synced=False)

    payload = {"id": session_id, "user_id": user_id, "session_title": request.session_title, "created_at": created_at}
    try:
        res = requests.post(rest_url("sessions"), json=payload,
                            headers=user_headers(token, json_body=True, prefer="resolution=merge-duplicates"),
                            timeout=5)
        if res.status_code in (200, 201):
            redis_client.mark_session_synced(session_id)
    except requests.RequestException as e:
        logger.warning(f"Supabase offline. Cached session in local queue: {e}")

    return {"id": session_id, "session_title": request.session_title, "user_id": user_id, "created_at": created_at}


@app.patch("/sessions/{session_id}", response_model=dict)
def rename_session(session_id: str, request: RenameSessionRequest, credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    session_id = validate_session_id(session_id)
    verify_session_ownership(session_id, user_id, token, allow_new=False)

    if not redis_client.get_session(session_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
    redis_client.update_session_title(session_id, request.session_title)

    try:
        res = requests.patch(rest_url("sessions"), params={"id": f"eq.{session_id}"},
                             json={"session_title": request.session_title},
                             headers=user_headers(token, json_body=True), timeout=5)
        if res.status_code in (200, 204):
            redis_client.mark_session_synced(session_id)
    except requests.RequestException as e:
        logger.warning(f"Supabase offline. Rename queued locally: {e}")

    session = redis_client.get_session(session_id)
    session["synced"] = session.get("synced") == "True"
    return session


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    session_id = validate_session_id(session_id)
    verify_session_ownership(session_id, user_id, token, allow_new=False)

    # 1. Tombstone, so the cloud deletion is retried by /sync if we are offline
    redis_client.client.set(f"deleted_session:{session_id}", user_id)
    # 2. Delete locally
    redis_client.delete_session(session_id)
    # 3. Delete in Supabase
    try:
        if delete_session_in_cloud(session_id, token):
            redis_client.client.delete(f"deleted_session:{session_id}")
    except requests.RequestException as e:
        logger.warning(f"Failed to delete session online: {e}. Queueing deletion.")

    return {"status": "deleted", "id": session_id}


# --- MESSAGES ---

@app.get("/sessions/{session_id}/messages", response_model=List[dict])
def get_messages(session_id: str, credentials: dict = Depends(get_current_user)):
    token = credentials["token"]
    session_id = validate_session_id(session_id)
    verify_session_ownership(session_id, credentials["user"]["id"], token, allow_new=False)

    # 1. Fetch from local Redis Cache
    local_messages = redis_client.get_session_messages(session_id)

    # 2. Try fetching from Supabase to sync/merge
    try:
        res = requests.get(rest_url("chat_messages"), headers=user_headers(token),
                           params={"session_id": f"eq.{session_id}", "order": "created_at.asc"}, timeout=5)
        if res.status_code == 200:
            import dateutil.parser
            local_ids = {m["id"] for m in local_messages}
            for cm in res.json():
                if cm["id"] not in local_ids:
                    try:
                        score = dateutil.parser.isoparse(cm["created_at"]).timestamp()
                    except (ValueError, TypeError):
                        score = time.time()
                    redis_client.save_message(
                        message_id=cm["id"],
                        session_id=session_id,
                        sender=cm["sender"],
                        text=cm["message_text"],
                        created_at=cm["created_at"],
                        score_timestamp=score,
                        synced=True
                    )
            # Re-fetch local cache after merging
            local_messages = redis_client.get_session_messages(session_id)
    except requests.RequestException as e:
        logger.warning(f"Could not fetch messages from Supabase: {e}. Serving from local cache.")

    return local_messages


@app.post("/messages", response_model=dict)
def create_message(request: CreateMessageRequest, credentials: dict = Depends(get_current_user)):
    token = credentials["token"]
    session_id = validate_session_id(request.session_id)
    verify_session_ownership(session_id, credentials["user"]["id"], token, allow_new=False)

    # 1. Save locally to Redis Cache
    redis_client.save_message(
        message_id=request.id,
        session_id=session_id,
        sender=request.sender,
        text=request.message_text,
        created_at=request.created_at,
        score_timestamp=time.time(),
        synced=False
    )

    # 2. Try posting to Supabase
    payload = {"id": request.id, "session_id": session_id, "sender": request.sender,
               "message_text": request.message_text, "created_at": request.created_at}
    try:
        res = requests.post(rest_url("chat_messages"), json=payload,
                            headers=user_headers(token, json_body=True), timeout=5)
        if res.status_code in (200, 201):
            redis_client.mark_message_synced(request.id)
    except requests.RequestException as e:
        logger.warning(f"Supabase offline. Cached message in local queue: {e}")

    return payload


# --- DOCUMENT PROCESSING AND INGESTION ---

def _transcribe_and_ingest(audio_path: str, session_id: str, credentials: dict) -> dict:
    transcription = audio_processor.transcribe(audio_path)
    logger.info(f"Ingesting transcript chunks for session_id {session_id}...")
    rag_pipeline.ingest_audio_transcript(
        audio_id=session_id,
        transcript=transcription["text"],
        token=credentials["token"],
        user_id=credentials["user"]["id"]
    )
    return {
        "transcript": transcription["text"],
        "segments": transcription["segments"],
        "language": transcription["language"],
        "language_probability": transcription["language_probability"]
    }


@app.post("/upload", status_code=200)
def upload_audio(
    file: UploadFile = File(...),
    session_id: str = Form(..., description="The unique session ID for this recording"),
    credentials: dict = Depends(get_current_user)
):
    session_id = validate_session_id(session_id)
    verify_session_ownership(session_id, credentials["user"]["id"], credentials["token"], allow_new=True)

    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format. Supported formats: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}"
        )

    with tempfile.TemporaryDirectory(prefix="tellme-audio-") as tmp:
        temp_file_path = os.path.join(tmp, f"upload{file_ext}")
        written = 0
        with open(temp_file_path, "wb") as buffer:
            while block := file.file.read(1024 * 1024):
                written += len(block)
                if written > settings.max_upload_bytes:
                    raise HTTPException(status_code=413,
                                        detail=f"File is larger than the {settings.max_upload_mb} MB limit.")
                buffer.write(block)

        try:
            result = _transcribe_and_ingest(temp_file_path, session_id, credentials)
        except Exception:
            logger.exception("Error during audio processing")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                                detail="Failed to transcribe and index the audio file.")
    return {"filename": file.filename, **result}


@app.post("/chat", status_code=200)
def chat_with_audio(request: ChatRequest, credentials: dict = Depends(get_current_user)):
    session_id = validate_session_id(request.audio_id)
    user_id = credentials["user"]["id"]
    verify_session_ownership(session_id, user_id, credentials["token"], allow_new=False)
    try:
        return rag_pipeline.answer_question(request.question, token=credentials["token"],
                                            user_id=user_id, audio_id=session_id)
    except Exception:
        logger.exception("Error during chat processing")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to generate an answer. Make sure Ollama is running."
        )


@app.post("/upload-link", status_code=200)
def upload_link(request: LinkRequest, credentials: dict = Depends(get_current_user)):
    session_id = validate_session_id(request.session_id)
    verify_session_ownership(session_id, credentials["user"]["id"], credentials["token"], allow_new=True)

    with tempfile.TemporaryDirectory(prefix="tellme-audio-") as tmp:
        try:
            audio_path = download_audio_from_url(request.url, os.path.join(tmp, "download"))
            return _transcribe_and_ingest(audio_path, session_id, credentials)
        except IngestError as e:
            raise HTTPException(status_code=422, detail=str(e))
        except Exception:
            logger.exception("Error during link ingestion")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                                detail="Failed to download, transcribe and index this link.")


if __name__ == "__main__":
    import uvicorn
    # Pass the app object directly and disable reloading for PyInstaller compatibility
    uvicorn.run(app, host=settings.host, port=settings.port)
