import os
import uuid
import shutil
import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, status, Form
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.redis_client import redis_client
from app.config import settings
from app.audio_processor import audio_processor
from app.rag_pipeline import rag_pipeline
from pydantic import BaseModel, Field
from typing import Optional

logger = logging.getLogger("uvicorn.error")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: connect to Redis and load Whisper model
    redis_client.connect()
    try:
        audio_processor.load_model(model_size="base")
    except Exception as e:
        logger.error(f"Startup warning: Whisper model could not be loaded: {e}")
    yield
    # Shutdown: close Redis connection
    redis_client.disconnect()

app = FastAPI(
    title="Audio Summarization RAG Backend",
    description="Backend API for Audio Summarization RAG pipeline",
    version="0.1.0",
    lifespan=lifespan
)

# CORS middleware configuration
origins = [
    "http://localhost:3000",  # Frontend dev server
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", status_code=200)
async def health_check():
    redis_alive = redis_client.ping()
    return {
        "status": "healthy" if redis_alive else "degraded",
        "redis_connected": redis_alive,
        "service": "Audio Summarization RAG API"
    }

@app.post("/upload", status_code=200)
async def upload_audio(
    file: UploadFile = File(...),
    session_id: str = Form(..., description="The unique session ID for this recording")
):
    # Validate file format
    allowed_extensions = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm"}
    file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format. Supported formats: {', '.join(allowed_extensions)}"
        )

    # Create temporary directory if it doesn't exist
    temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "temp_audio")
    os.makedirs(temp_dir, exist_ok=True)

    # Save file to temp path
    temp_file_name = f"{uuid.uuid4()}{file_ext}"
    temp_file_path = os.path.join(temp_dir, temp_file_name)

    try:
        # Save upload stream to temporary file
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Transcribe audio file
        transcription_result = audio_processor.transcribe(temp_file_path)

        # Ingest transcript chunks into Redis vector DB
        logger.info(f"Ingesting transcript chunks for session_id {session_id} into Redis...")
        rag_pipeline.ingest_audio_transcript(
            audio_id=session_id,
            transcript=transcription_result["text"]
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
        # Clean up temporary file
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
async def chat_with_audio(request: ChatRequest):
    try:
        response = rag_pipeline.answer_question(request.question, audio_id=request.audio_id)
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
async def upload_link(request: LinkRequest):
    if not request.url or not request.session_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="url and session_id are required fields"
        )

    # Create temporary directory if it doesn't exist
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

        # Ingest transcript chunks into Redis vector DB
        logger.info(f"Ingesting transcript chunks for session_id {request.session_id} into Redis...")
        rag_pipeline.ingest_audio_transcript(
            audio_id=request.session_id,
            transcript=transcription_result["text"]
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
        # Clean up temporary file
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as e:
                logger.error(f"Failed to delete temporary file {temp_file_path}: {e}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=True)

