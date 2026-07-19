import os
import uuid
import shutil
import logging
import requests
import time
from fastapi import FastAPI, UploadFile, File, HTTPException, status, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from pydantic import BaseModel, Field
from typing import Optional, List

from app.config import settings
from app.audio_processor import audio_processor
from app.rag_pipeline import rag_pipeline
from app.redis_client import redis_client

logger = logging.getLogger("uvicorn.error")

security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    token = credentials.credentials
    if not settings.supabase_url or not settings.supabase_anon_key:
        logger.error("Supabase config is missing on backend")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication configuration is missing on the server."
        )
    
    url = f"{settings.supabase_url}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=5)
        if response.status_code == 200:
            user_info = response.json()
            user_id = user_info["id"]
            if redis_client.client:
                redis_client.client.setex(f"user_token:{user_id}", 3600, token)
            return {"user": user_info, "token": token}
        else:
            logger.error(f"Supabase auth verification failed. Status: {response.status_code}, Body: {response.text}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid or expired session token: {response.text}"
            )
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as network_err:
        logger.warning(f"Supabase connection failed ({network_err}). Falling back to offline JWT decode.")
        try:
            import base64
            import json
            parts = token.split(".")
            if len(parts) == 3:
                payload_b64 = parts[1]
                payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
                payload_bytes = base64.urlsafe_b64decode(payload_b64)
                payload = json.loads(payload_bytes.decode("utf-8"))
                
                user_id = payload.get("sub")
                email = payload.get("email")
                if user_id:
                    user_info = {"id": user_id, "email": email}
                    if redis_client.client:
                        redis_client.client.setex(f"user_token:{user_id}", 3600, token)
                    return {"user": user_info, "token": token}
        except Exception as decode_err:
            logger.error(f"Failed to decode token offline: {decode_err}")
        
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed. Network is offline and token is invalid."
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Supabase auth check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed."
        )

def verify_session_ownership(session_id: str, token: str, is_new_allowed: bool = True):
    url = f"{settings.supabase_url}/rest/v1/sessions"
    headers = {
        "apikey": settings.supabase_anon_key
    }
    params = {
        "id": f"eq.{session_id}",
        "select": "id,user_id"
    }
    try:
        res = requests.get(url, headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            data = res.json()
            if not data:
                if is_new_allowed:
                    return
                else:
                    raise HTTPException(status_code=404, detail="Session not found.")
            
            user_headers = {
                "Authorization": f"Bearer {token}",
                "apikey": settings.supabase_anon_key
            }
            res_user = requests.get(url, headers=user_headers, params=params, timeout=5)
            if res_user.status_code != 200 or not res_user.json():
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to session.")
        else:
            logger.error(f"Error checking session: {res.status_code} {res.text}")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access verification failed.")
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as network_err:
        logger.warning(f"Supabase connection failed during ownership check ({network_err}). Verifying via local Redis.")
        if redis_client.client:
            sess_data = redis_client.client.hgetall(f"session:{session_id}")
            if sess_data:
                try:
                    import base64
                    import json
                    parts = token.split(".")
                    if len(parts) == 3:
                        payload_b64 = parts[1]
                        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
                        payload_bytes = base64.urlsafe_b64decode(payload_b64)
                        payload = json.loads(payload_bytes.decode("utf-8"))
                        user_id = payload.get("sub")
                        if sess_data.get("user_id") == user_id:
                            return # Verified successfully!
                except Exception as decode_err:
                    logger.error(f"Failed to verify local session ownership offline: {decode_err}")
            else:
                if is_new_allowed:
                    return # Allow creating new offline sessions
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access verification failed offline.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Session verification exception: {e}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access verification failed.")

def sync_user_data(user_id: str, token: str):
    """Flushes unsynced local Redis sessions, messages, and vector chunks to Supabase for the authenticated user."""
    if not redis_client.client:
        return
        
    try:
        # Pre-filter to check if any updates actually exist for this user
        raw_sessions = redis_client.get_unsynced_sessions()
        unsynced_sessions = [s for s in raw_sessions if s.get("user_id") == user_id]

        raw_messages = redis_client.get_unsynced_messages()
        unsynced_messages = []
        for msg in raw_messages:
            session_id = msg["session_id"]
            sess_data = redis_client.client.hgetall(f"session:{session_id}")
            if sess_data and sess_data.get("user_id") == user_id:
                unsynced_messages.append(msg)

        raw_chunks = redis_client.get_unsynced_chunks()
        unsynced_chunks = [c for c in raw_chunks if c.get("user_id") == user_id]

        deleted_keys = redis_client.client.keys("deleted_session:*")
        pending_deletions = []
        for dk in deleted_keys:
            stored_uid = redis_client.client.get(dk)
            if stored_uid == user_id:
                pending_deletions.append(dk)

        has_updates = (
            len(unsynced_sessions) > 0 or
            len(unsynced_messages) > 0 or
            len(unsynced_chunks) > 0 or
            len(pending_deletions) > 0
        )

        if not has_updates:
            return # Silence log and skip execution if no modifications exist

        logger.info(f"Sync task: Flushing offline queue to Supabase for user {user_id}... "
                    f"(sessions: {len(unsynced_sessions)}, messages: {len(unsynced_messages)}, "
                    f"chunks: {len(unsynced_chunks)}, deletions: {len(pending_deletions)})")

        # 1. Sync Sessions
        for sess in unsynced_sessions:
            url = f"{settings.supabase_url}/rest/v1/sessions"
            headers = {
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates"
            }
            payload = {
                "id": sess["id"],
                "user_id": sess["user_id"],
                "session_title": sess["session_title"],
                "created_at": sess["created_at"]
            }
            res = requests.post(url, json=payload, headers=headers, timeout=5)
            if res.status_code in (200, 201):
                redis_client.mark_session_synced(sess["id"])
                logger.info(f"Synced session {sess['id']} to Supabase.")

        # 2. Sync Messages
        for msg in unsynced_messages:
            url = f"{settings.supabase_url}/rest/v1/chat_messages"
            headers = {
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            payload = {
                "id": msg["id"],
                "session_id": msg["session_id"],
                "sender": msg["sender"],
                "message_text": msg["message_text"],
                "created_at": msg["created_at"]
            }
            res = requests.post(url, json=payload, headers=headers, timeout=5)
            if res.status_code in (200, 201):
                redis_client.mark_message_synced(msg["id"])
                logger.info(f"Synced message {msg['id']} to Supabase.")

        # 3. Sync Chunks
        for chunk in unsynced_chunks:
            url = f"{settings.supabase_url}/rest/v1/document_chunks"
            headers = {
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            payload = {
                "session_id": chunk["session_id"],
                "chunk_index": int(chunk["chunk_index"]),
                "content": chunk["content"],
                "embedding": chunk["embedding"],
                "user_id": chunk["user_id"]
            }
            res = requests.post(url, json=payload, headers=headers, timeout=5)
            if res.status_code in (200, 201):
                redis_client.mark_chunk_synced(chunk["redis_key"])
                logger.info(f"Synced chunk {chunk['redis_key']} to Supabase.")

        # 4. Sync Deletions
        for dk in pending_deletions:
            session_id = dk.split(":", 1)[1]
            headers = {
                "apikey": settings.supabase_anon_key,
                "Authorization": f"Bearer {token}"
            }
            # Delete document chunks first to satisfy foreign key constraints
            chunk_url = f"{settings.supabase_url}/rest/v1/document_chunks?session_id=eq.{session_id}"
            requests.delete(chunk_url, headers=headers, timeout=5)

            # Delete messages second
            msg_url = f"{settings.supabase_url}/rest/v1/chat_messages?session_id=eq.{session_id}"
            requests.delete(msg_url, headers=headers, timeout=5)

            # Delete parent session last
            sess_url = f"{settings.supabase_url}/rest/v1/sessions?id=eq.{session_id}"
            res = requests.delete(sess_url, headers=headers, timeout=5)
            if res.status_code in (200, 204):
                redis_client.client.delete(dk)
                logger.info(f"Synced deletion of session {session_id} to Supabase.")
    except Exception as e:
        logger.error(f"Sync error during data flush: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to local Redis Stack and load Whisper
    redis_client.connect()
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
    version="0.1.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=".*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CreateSessionRequest(BaseModel):
    id: str
    session_title: str

class CreateMessageRequest(BaseModel):
    id: str
    session_id: str
    sender: str
    message_text: str
    created_at: str

@app.get("/health", status_code=200)
async def health_check():
    redis_alive = redis_client.ping()
    return {
        "status": "healthy" if redis_alive else "degraded",
        "redis_connected": redis_alive,
        "service": "Audio Summarization RAG API"
    }

import threading
import urllib.request
import zipfile
import subprocess
from fastapi.responses import StreamingResponse

# Global status tracking for Ollama auto-installer
ollama_install_progress = {"status": "idle", "progress": 0}

def download_and_install_ollama_bg():
    global ollama_install_progress
    ollama_install_progress["status"] = "downloading"
    ollama_install_progress["progress"] = 0
    zip_path = "/tmp/Ollama-darwin.zip"
    url = "https://ollama.com/download/Ollama-darwin.zip"
    
    try:
        def reporthook(blocknum, blocksize, totalsize):
            readsofar = blocknum * blocksize
            if totalsize > 0:
                percent = min(100, int(readsofar * 100 / totalsize))
                ollama_install_progress["progress"] = percent
            else:
                ollama_install_progress["progress"] = 0
                
        logger.info("Starting Ollama app download...")
        urllib.request.urlretrieve(url, zip_path, reporthook)
        
        ollama_install_progress["status"] = "extracting"
        ollama_install_progress["progress"] = 90
        logger.info("Extracting Ollama to /Applications...")
        
        # Check if zip exists
        if os.path.exists(zip_path):
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall("/Applications")
        
        ollama_install_progress["status"] = "starting"
        ollama_install_progress["progress"] = 95
        logger.info("Launching Ollama.app...")
        
        # Launch Ollama app cleanly on Mac
        subprocess.Popen(["open", "-a", "Ollama"])
        
        # Wait a bit and check if port is up
        import time
        for _ in range(15):
            time.sleep(1)
            try:
                if requests.get("http://localhost:11434/api/tags").status_code == 200:
                    ollama_install_progress["status"] = "completed"
                    ollama_install_progress["progress"] = 100
                    logger.info("Ollama is successfully installed, launched, and listening.")
                    return
            except:
                pass
        ollama_install_progress["status"] = "started_checking"
        ollama_install_progress["progress"] = 100
    except Exception as e:
        logger.error(f"Failed to install Ollama: {e}")
        ollama_install_progress["status"] = f"error: {str(e)}"
        ollama_install_progress["progress"] = 0

@app.get("/ollama/status")
async def get_ollama_status():
    ollama_running = False
    model_pulled = False
    
    try:
        # Check if Ollama is listening
        res = requests.get("http://localhost:11434/api/tags", timeout=2)
        if res.status_code == 200:
            ollama_running = True
            data = res.json()
            models = [m.get("name", "") for m in data.get("models", [])]
            # Check if the configured model is pulled (matches name or latest tag)
            target = settings.llm_model
            model_pulled = any(target in m or m.startswith(target) for m in models)
    except Exception:
        pass
        
    return {
        "ollama_running": ollama_running,
        "model_pulled": model_pulled,
        "configured_model": settings.llm_model
    }

@app.post("/ollama/install")
async def trigger_ollama_install():
    global ollama_install_progress
    if ollama_install_progress["status"] in ("downloading", "extracting", "starting"):
        return {"message": "Installation already in progress.", "status": ollama_install_progress}
        
    # Start installation thread
    thread = threading.Thread(target=download_and_install_ollama_bg)
    thread.daemon = True
    thread.start()
    return {"message": "Ollama installation triggered.", "status": ollama_install_progress}

@app.get("/ollama/install/status")
async def get_ollama_install_status():
    global ollama_install_progress
    return ollama_install_progress

@app.post("/ollama/pull")
def pull_ollama_model():
    def generate():
        url = "http://localhost:11434/api/pull"
        payload = {"name": settings.llm_model}
        try:
            # Request stream from local Ollama
            res = requests.post(url, json=payload, stream=True, timeout=3600)
            for line in res.iter_lines():
                if line:
                    yield line.decode("utf-8") + "\n"
        except Exception as e:
            import json
            yield json.dumps({"status": "error", "message": str(e)}) + "\n"
    return StreamingResponse(generate(), media_type="text/event-stream")

# --- EVENT-DRIVEN SYNC TRIGGER ENDPOINT ---

@app.post("/sync", status_code=200)
async def trigger_reconnect_sync(credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    sync_user_data(user_id, token)
    return {"status": "completed", "user_id": user_id}

# --- MEDIATOR SESSIONS ENDPOINTS ---

@app.get("/sessions", response_model=List[dict])
async def get_sessions(credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    
    # 1. Fetch from local Redis Cache
    local_sessions = redis_client.get_user_sessions(user_id)
    
    # 2. Try fetching from Supabase to sync/merge
    url = f"{settings.supabase_url}/rest/v1/sessions"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key
    }
    params = {
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc"
    }
    try:
        res = requests.get(url, headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            cloud_sessions = res.json()
            # Merge any cloud sessions not present in local cache
            local_ids = {s["id"] for s in local_sessions}
            for cs in cloud_sessions:
                if cs["id"] not in local_ids:
                    redis_client.save_session(
                        session_id=cs["id"],
                        user_id=user_id,
                        title=cs["session_title"],
                        created_at=cs["created_at"],
                        synced=True
                    )
            # Re-fetch local cache after merging
            local_sessions = redis_client.get_user_sessions(user_id)
    except Exception as e:
        logger.warning(f"Could not fetch sessions from Supabase: {e}. Falling back to local cache.")
        
    return local_sessions

@app.post("/sessions", response_model=dict)
async def create_session(request: CreateSessionRequest, credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    created_at = time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime())
    
    # 1. Save locally to Redis Cache
    redis_client.save_session(
        session_id=request.id,
        user_id=user_id,
        title=request.session_title,
        created_at=created_at,
        synced=False
    )
    
    # 2. Try posting to Supabase in parallel
    url = f"{settings.supabase_url}/rest/v1/sessions"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key,
        "Content-Type": "application/json"
    }
    payload = {
        "id": request.id,
        "user_id": user_id,
        "session_title": request.session_title,
        "created_at": created_at
    }
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=5)
        if res.status_code in (200, 201):
            redis_client.mark_session_synced(request.id)
    except Exception as e:
        logger.warning(f"Supabase offline. Cached session in local queue: {e}")
        
    return {"id": request.id, "session_title": request.session_title, "user_id": user_id, "created_at": created_at}

@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, credentials: dict = Depends(get_current_user)):
    user_id = credentials["user"]["id"]
    token = credentials["token"]
    
    # 1. Cache deletion tombstone in Redis
    if redis_client.client:
        redis_client.client.set(f"deleted_session:{session_id}", user_id)
        
    # 2. Delete locally from Redis
    redis_client.delete_session(session_id)
    
    # 3. Try deleting from online Supabase in parallel
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key
    }
    try:
        # Delete document chunks first to satisfy foreign key constraints
        chunk_url = f"{settings.supabase_url}/rest/v1/document_chunks?session_id=eq.{session_id}"
        requests.delete(chunk_url, headers=headers, timeout=5)

        # Delete messages second
        msg_url = f"{settings.supabase_url}/rest/v1/chat_messages?session_id=eq.{session_id}"
        requests.delete(msg_url, headers=headers, timeout=5)
        
        # Delete session last
        sess_url = f"{settings.supabase_url}/rest/v1/sessions?id=eq.{session_id}"
        res = requests.delete(sess_url, headers=headers, timeout=5)
        if res.status_code in (200, 204) and redis_client.client:
            redis_client.client.delete(f"deleted_session:{session_id}")
    except Exception as e:
        logger.warning(f"Failed to delete session online: {e}. Queueing deletion.")
        
    return {"status": "deleted", "id": session_id}

# --- MEDIATOR MESSAGES ENDPOINTS ---

@app.get("/sessions/{session_id}/messages", response_model=List[dict])
async def get_messages(session_id: str, credentials: dict = Depends(get_current_user)):
    token = credentials["token"]
    
    # 1. Fetch from local Redis Cache
    local_messages = redis_client.get_session_messages(session_id)
    
    # 2. Try fetching from Supabase to sync/merge
    url = f"{settings.supabase_url}/rest/v1/chat_messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key
    }
    params = {
        "session_id": f"eq.{session_id}",
        "order": "created_at.asc"
    }
    try:
        res = requests.get(url, headers=headers, params=params, timeout=5)
        if res.status_code == 200:
            cloud_messages = res.json()
            local_ids = {m["id"] for m in local_messages}
            for cm in cloud_messages:
                if cm["id"] not in local_ids:
                    try:
                        import dateutil.parser
                        dt = dateutil.parser.isoparse(cm["created_at"])
                        score = dt.timestamp()
                    except Exception:
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
    except Exception as e:
        logger.warning(f"Could not fetch messages from Supabase: {e}. Serving from local cache.")
        
    return local_messages

@app.post("/messages", response_model=dict)
async def create_message(request: CreateMessageRequest, credentials: dict = Depends(get_current_user)):
    token = credentials["token"]
    
    # 1. Save locally to Redis Cache
    redis_client.save_message(
        message_id=request.id,
        session_id=request.session_id,
        sender=request.sender,
        text=request.message_text,
        created_at=request.created_at,
        score_timestamp=time.time(),
        synced=False
    )
    
    # 2. Try posting to Supabase in parallel
    url = f"{settings.supabase_url}/rest/v1/chat_messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": settings.supabase_anon_key,
        "Content-Type": "application/json"
    }
    payload = {
        "id": request.id,
        "session_id": request.session_id,
        "sender": request.sender,
        "message_text": request.message_text,
        "created_at": request.created_at
    }
    try:
        res = requests.post(url, json=payload, headers=headers, timeout=5)
        if res.status_code in (200, 201):
            redis_client.mark_message_synced(request.id)
    except Exception as e:
        logger.warning(f"Supabase offline. Cached message in local queue: {e}")
        
    return {"id": request.id, "session_id": request.session_id, "sender": request.sender, "message_text": request.message_text, "created_at": request.created_at}

# --- DOCUMENT PROCESSING AND INGESTION ---

@app.post("/upload", status_code=200)
async def upload_audio(
    file: UploadFile = File(...),
    session_id: str = Form(..., description="The unique session ID for this recording"),
    credentials: dict = Depends(get_current_user)
):
    # Verify session ownership
    verify_session_ownership(session_id, credentials["token"], is_new_allowed=True)
    # Validate file format
    allowed_extensions = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format. Supported formats: {', '.join(allowed_extensions)}"
        )

    # Save to temp audio file
    temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "temp_audio")
    os.makedirs(temp_dir, exist_ok=True)
    temp_file_name = f"{uuid.uuid4()}{file_ext}"
    temp_file_path = os.path.join(temp_dir, temp_file_name)

    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Transcribe audio file
        transcription_result = audio_processor.transcribe(temp_file_path)

        # Ingest transcript chunks into RAG pipeline
        logger.info(f"Ingesting transcript chunks for session_id {session_id}...")
        rag_pipeline.ingest_audio_transcript(
            audio_id=session_id,
            transcript=transcription_result["text"],
            token=credentials["token"],
            user_id=credentials["user"]["id"]
        )

        return {
            "filename": file.filename,
            "transcript": transcription_result["text"],
            "segments": transcription_result["segments"],
            "language": transcription_result["language"],
            "language_probability": transcription_result["language_probability"]
        }
    except Exception as e:
        logger.error(f"Error during audio processing: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process and transcribe audio: {str(e)}"
        )
    finally:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as e:
                logger.error(f"Failed to delete temporary file {temp_file_path}: {e}")

class ChatRequest(BaseModel):
    question: str = Field(..., description="The user's question about the audio recording")
    audio_id: Optional[str] = Field(None, description="The unique identifier of the audio file")

@app.post("/chat", status_code=200)
async def chat_with_audio(
    request: ChatRequest,
    credentials: dict = Depends(get_current_user)
):
    if request.audio_id:
        verify_session_ownership(request.audio_id, credentials["token"], is_new_allowed=False)
    try:
        response = rag_pipeline.answer_question(request.question, token=credentials["token"], audio_id=request.audio_id)
        return response
    except Exception as e:
        logger.error(f"Error during chat processing: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate answer from local LLM: {str(e)}"
        )

class LinkRequest(BaseModel):
    url: str = Field(..., description="YouTube or direct audio file URL")
    session_id: str = Field(..., description="Unique session ID for indexing")

@app.post("/upload-link", status_code=200)
async def upload_link(
    request: LinkRequest,
    credentials: dict = Depends(get_current_user)
):
    if not request.url or not request.session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="url and session_id are required fields"
        )

    verify_session_ownership(request.session_id, credentials["token"], is_new_allowed=True)

    temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "temp_audio")
    os.makedirs(temp_dir, exist_ok=True)
    temp_file_base = os.path.join(temp_dir, str(uuid.uuid4()))
    temp_file_path = None

    try:
        from app.url_processor import download_audio_from_url
        logger.info(f"Downloading link: {request.url}")
        temp_file_path = download_audio_from_url(request.url, temp_file_base)

        # Transcribe audio file
        logger.info(f"Transcribing audio file: {temp_file_path}")
        transcription_result = audio_processor.transcribe(temp_file_path)

        # Ingest transcript chunks into RAG pipeline
        logger.info(f"Ingesting transcript chunks for session_id {request.session_id}...")
        rag_pipeline.ingest_audio_transcript(
            audio_id=request.session_id,
            transcript=transcription_result["text"],
            token=credentials["token"],
            user_id=credentials["user"]["id"]
        )

        return {
            "transcript": transcription_result["text"],
            "segments": transcription_result["segments"],
            "language": transcription_result["language"],
            "language_probability": transcription_result["language_probability"]
        }
    except Exception as e:
        logger.error(f"Error during link ingestion: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to ingest and process link: {str(e)}"
        )
    finally:
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as e:
                logger.error(f"Failed to delete temporary file {temp_file_path}: {e}")

if __name__ == "__main__":
    import uvicorn
    # Pass the app object directly and disable reloading for PyInstaller compatibility
    uvicorn.run(app, host=settings.host, port=settings.port)
