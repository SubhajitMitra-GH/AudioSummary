"""Ingestion, chat, health and Ollama routes."""
import io
import os
import uuid

import pytest
import redis
import requests
from fastapi.testclient import TestClient

from app import main
from app.auth import get_current_user
from app.main import app
from app.redis_client import redis_client
from app.url_processor import IngestError
from tests.conftest import FakeResponse

USER_A = {"user": {"id": "user-a", "email": "a@example.com"}, "token": "token-a"}
TRANSCRIPTION = {"text": "hello world", "segments": [], "language": "en", "language_probability": 0.99}


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: USER_A
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def pipeline_spy(monkeypatch):
    calls = {}

    def transcribe(path):
        calls["path"] = path
        calls["existed"] = os.path.exists(path)
        return TRANSCRIPTION

    def ingest(**kwargs):
        calls["ingest"] = kwargs
        return 1

    monkeypatch.setattr(main.audio_processor, "transcribe", transcribe)
    monkeypatch.setattr(main.rag_pipeline, "ingest_audio_transcript", ingest)
    return calls


def _own_session() -> str:
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01T00:00:00.000Z", synced=True)
    return sid


# --- upload ---

def test_upload_transcribes_indexes_and_deletes_the_temp_file(client, pipeline_spy):
    sid = str(uuid.uuid4())
    res = client.post("/upload", data={"session_id": sid},
                      files={"file": ("talk.mp3", io.BytesIO(b"audio-bytes"), "audio/mpeg")})
    assert res.status_code == 200
    assert res.json()["transcript"] == "hello world"
    assert res.json()["filename"] == "talk.mp3"
    assert pipeline_spy["existed"] is True
    assert not os.path.exists(pipeline_spy["path"])  # cleaned up afterwards
    assert pipeline_spy["ingest"]["audio_id"] == sid
    assert pipeline_spy["ingest"]["user_id"] == "user-a"


def test_upload_into_another_users_session_is_forbidden(client, pipeline_spy):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-b", "t", "2026-01-01T00:00:00.000Z", synced=True)
    res = client.post("/upload", data={"session_id": sid},
                      files={"file": ("talk.mp3", io.BytesIO(b"x"), "audio/mpeg")})
    assert res.status_code == 403
    assert "ingest" not in pipeline_spy


def test_upload_failure_returns_a_generic_error(client, monkeypatch):
    def boom(path):
        raise RuntimeError("internal path /secret/xyz")
    monkeypatch.setattr(main.audio_processor, "transcribe", boom)
    res = client.post("/upload", data={"session_id": str(uuid.uuid4())},
                      files={"file": ("talk.mp3", io.BytesIO(b"x"), "audio/mpeg")})
    assert res.status_code == 500
    assert "/secret/xyz" not in res.text


def test_upload_with_invalid_session_id_is_rejected(client):
    res = client.post("/upload", data={"session_id": "../../etc"},
                      files={"file": ("talk.mp3", io.BytesIO(b"x"), "audio/mpeg")})
    assert res.status_code == 400


# --- upload-link ---

def test_link_ingestion_success(client, pipeline_spy, monkeypatch):
    def fake_download(url, base):
        path = base + ".mp3"
        open(path, "wb").write(b"audio")
        return path
    monkeypatch.setattr(main, "download_audio_from_url", fake_download)

    res = client.post("/upload-link", json={"url": "https://example.com/a.mp3", "session_id": str(uuid.uuid4())})
    assert res.status_code == 200
    assert res.json()["transcript"] == "hello world"
    assert not os.path.exists(pipeline_spy["path"])


def test_link_ingestion_shows_user_friendly_errors(client, monkeypatch):
    def fail(url, base):
        raise IngestError("This link opens a web page, not an audio file.")
    monkeypatch.setattr(main, "download_audio_from_url", fail)
    res = client.post("/upload-link", json={"url": "https://open.spotify.com/x", "session_id": str(uuid.uuid4())})
    assert res.status_code == 422
    assert res.json()["detail"] == "This link opens a web page, not an audio file."


def test_link_ingestion_hides_unexpected_errors(client, monkeypatch):
    def fail(url, base):
        raise RuntimeError("Traceback with secrets")
    monkeypatch.setattr(main, "download_audio_from_url", fail)
    res = client.post("/upload-link", json={"url": "https://example.com/a.mp3", "session_id": str(uuid.uuid4())})
    assert res.status_code == 500
    assert "secrets" not in res.text


# --- chat ---

def test_chat_answers_from_the_users_own_session(client, monkeypatch):
    sid = _own_session()
    seen = {}

    def answer(question, token, user_id, audio_id):
        seen.update(question=question, user_id=user_id, audio_id=audio_id)
        return {"answer": "42", "context": []}
    monkeypatch.setattr(main.rag_pipeline, "answer_question", answer)

    res = client.post("/chat", json={"question": "meaning of life?", "audio_id": sid})
    assert res.status_code == 200
    assert res.json()["answer"] == "42"
    assert seen == {"question": "meaning of life?", "user_id": "user-a", "audio_id": sid}


def test_chat_on_another_users_session_is_forbidden(client):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-b", "t", "2026-01-01T00:00:00.000Z", synced=True)
    assert client.post("/chat", json={"question": "q", "audio_id": sid}).status_code == 403


def test_chat_on_unknown_session_is_404(client):
    assert client.post("/chat", json={"question": "q", "audio_id": str(uuid.uuid4())}).status_code == 404


def test_chat_llm_failure_returns_a_helpful_error(client, monkeypatch):
    sid = _own_session()

    def fail(**kwargs):
        raise ConnectionError("ollama down")
    monkeypatch.setattr(main.rag_pipeline, "answer_question", lambda *a, **k: fail())
    res = client.post("/chat", json={"question": "q", "audio_id": sid})
    assert res.status_code == 500
    assert "Ollama" in res.json()["detail"]


def test_empty_question_is_rejected(client):
    assert client.post("/chat", json={"question": "", "audio_id": _own_session()}).status_code == 422


# --- health ---

def test_health_reports_healthy_with_redis(client):
    assert client.get("/health").json()["status"] == "healthy"


def test_health_reports_degraded_when_redis_is_down(client, monkeypatch):
    def down():
        raise redis.ConnectionError()
    monkeypatch.setattr(redis_client.client, "ping", down)
    body = client.get("/health").json()
    assert body["status"] == "degraded"
    assert body["redis_connected"] is False


# --- ollama ---

@pytest.mark.parametrize("models,pulled", [
    (["mistral:latest"], True),
    (["mistral"], True),
    (["mistral-nemo:latest"], False),
    ([], False),
])
def test_ollama_model_detection(client, monkeypatch, models, pulled):
    monkeypatch.setattr(main.settings, "llm_model", "mistral")
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, {"models": [{"name": m} for m in models]}))
    body = client.get("/ollama/status").json()
    assert body["ollama_running"] is True
    assert body["model_pulled"] is pulled


def test_ollama_status_when_ollama_is_not_running(client):
    body = client.get("/ollama/status").json()
    assert body == {"ollama_running": False, "model_pulled": False, "configured_model": main.settings.llm_model}


@pytest.fixture
def reset_install_state():
    main._set_install("idle", 0)
    yield
    main._set_install("idle", 0)


def test_ollama_install_is_macos_only(client, monkeypatch, reset_install_state):
    monkeypatch.setattr(main.sys, "platform", "linux")
    assert client.post("/ollama/install").status_code == 400


def test_ollama_install_starts_only_once(client, monkeypatch, reset_install_state):
    started = []

    class FakeThread:
        def __init__(self, target, daemon):
            pass

        def start(self):
            started.append(True)

    monkeypatch.setattr(main.sys, "platform", "darwin")
    monkeypatch.setattr(main.threading, "Thread", FakeThread)

    first = client.post("/ollama/install").json()
    second = client.post("/ollama/install").json()
    assert first["message"] == "Ollama installation triggered."
    assert second["message"] == "Installation already in progress."
    assert len(started) == 1
    assert client.get("/ollama/install/status").json()["status"] == "downloading"


def test_ollama_pull_streams_progress(client, monkeypatch):
    body = b'{"status":"pulling manifest"}\n{"status":"success"}'
    monkeypatch.setattr(requests, "post", lambda *a, **k: FakeResponse(200, body=body))
    lines = client.post("/ollama/pull").text.strip().split("\n")
    assert lines == ['{"status":"pulling manifest"}', '{"status":"success"}']


def test_ollama_pull_reports_errors_as_a_stream_line(client, monkeypatch):
    monkeypatch.setattr(requests, "post", lambda *a, **k: FakeResponse(500))
    assert '"status": "error"' in client.post("/ollama/pull").text


def test_ollama_pull_reports_unreachable_ollama(client):
    text = client.post("/ollama/pull").text
    assert '"status": "error"' in text
    assert "Could not reach Ollama" in text
