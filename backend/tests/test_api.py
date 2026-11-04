"""S3/S4/S6/B6 and upload limits, tested through the HTTP API."""
import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings, settings
from app.main import app
from app.redis_client import redis_client

USER_A = {"user": {"id": "user-a", "email": "a@example.com"}, "token": "token-a"}


@pytest.fixture
def client():
    # Not used as a context manager, so the startup hook (Redis connect, Whisper load) is skipped.
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def as_user_a():
    app.dependency_overrides[get_current_user] = lambda: USER_A


def _session(owner: str, created_at="2026-01-01T00:00:00.000Z") -> str:
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, owner, "ciphertext-title", created_at, synced=True)
    return sid


def test_server_binds_to_localhost_by_default():
    assert Settings(_env_file=None).host == "127.0.0.1"


@pytest.mark.parametrize("path", ["/ollama/install", "/ollama/pull"])
def test_ollama_install_and_pull_require_login(client, path):
    assert client.post(path).status_code in (401, 403)


def test_cors_rejects_random_websites(client):
    res = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers


@pytest.mark.parametrize("origin", ["app://index.html", "http://localhost:3000"])
def test_cors_allows_the_app(client, origin):
    res = client.get("/health", headers={"Origin": origin})
    assert res.headers.get("access-control-allow-origin") == origin


def test_cannot_delete_another_users_session(client, as_user_a):
    sid = _session("user-b")
    res = client.delete(f"/sessions/{sid}")
    assert res.status_code == 403
    assert redis_client.get_session(sid) is not None


def test_cannot_read_another_users_messages(client, as_user_a):
    sid = _session("user-b")
    assert client.get(f"/sessions/{sid}/messages").status_code == 403


def test_cannot_post_into_another_users_session(client, as_user_a):
    sid = _session("user-b")
    res = client.post("/messages", json={
        "id": str(uuid.uuid4()), "session_id": sid, "sender": "user",
        "message_text": "x", "created_at": "2026-01-01T00:00:00Z",
    })
    assert res.status_code == 403


def test_owner_can_delete_own_session(client, as_user_a):
    sid = _session("user-a")
    assert client.delete(f"/sessions/{sid}").status_code == 200
    assert redis_client.get_session(sid) is None


def test_rename_keeps_created_at(client, as_user_a):
    sid = _session("user-a", created_at="2025-05-05T10:00:00.000Z")
    res = client.patch(f"/sessions/{sid}", json={"session_title": "new-ciphertext"})
    assert res.status_code == 200
    stored = redis_client.get_session(sid)
    assert stored["session_title"] == "new-ciphertext"
    assert stored["created_at"] == "2025-05-05T10:00:00.000Z"


def test_create_existing_session_does_not_reset_date(client, as_user_a):
    sid = _session("user-a", created_at="2025-05-05T10:00:00.000Z")
    res = client.post("/sessions", json={"id": sid, "session_title": "other"})
    assert res.status_code == 200
    assert redis_client.get_session(sid)["created_at"] == "2025-05-05T10:00:00.000Z"


def test_chat_requires_a_session(client, as_user_a):
    assert client.post("/chat", json={"question": "hi"}).status_code == 422


def test_upload_over_size_limit_is_rejected(client, as_user_a, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    res = client.post(
        "/upload",
        data={"session_id": str(uuid.uuid4())},
        files={"file": ("a.mp3", io.BytesIO(b"x" * 10), "audio/mpeg")},
    )
    assert res.status_code == 413


def test_upload_rejects_unsupported_extension(client, as_user_a):
    res = client.post(
        "/upload",
        data={"session_id": str(uuid.uuid4())},
        files={"file": ("a.exe", io.BytesIO(b"x"), "application/octet-stream")},
    )
    assert res.status_code == 400
