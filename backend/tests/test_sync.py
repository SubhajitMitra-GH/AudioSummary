"""Offline queue flushing (/sync) and merging cloud data into the local cache."""
import uuid

import pytest
import requests
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.main import app, sync_user_data
from app.redis_client import redis_client
from tests.conftest import FakeResponse

USER_A = {"user": {"id": "user-a", "email": "a@example.com"}, "token": "token-a"}


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: USER_A
    yield TestClient(app)
    app.dependency_overrides.clear()


class Recorder:
    """Records HTTP calls and answers with a fixed status."""

    def __init__(self, status=201):
        self.calls = []
        self.status = status

    def __call__(self, url, **kwargs):
        self.calls.append((url, kwargs))
        return FakeResponse(self.status)

    def urls(self):
        return [url for url, _ in self.calls]


def _seed_user_a():
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "title-a", "2026-01-01T00:00:00.000Z", synced=False)
    redis_client.save_message("m1", sid, "user", "hello", "2026-01-01T00:00:01Z", 1.0, synced=False)
    redis_client.save_chunk(sid, 0, "c0", [0.1] * 384, "user-a", synced=False)
    redis_client.save_chunk(sid, 1, "c1", [0.2] * 384, "user-a", synced=False)
    return sid


def test_sync_pushes_only_this_users_data_and_marks_it_synced(monkeypatch):
    sid = _seed_user_a()
    other = str(uuid.uuid4())
    redis_client.save_session(other, "user-b", "title-b", "2026-01-01T00:00:00.000Z", synced=False)

    post = Recorder(201)
    monkeypatch.setattr(requests, "post", post)
    sync_user_data("user-a", "token-a")

    session_payloads = [kw["json"] for url, kw in post.calls if url.endswith("/sessions")]
    assert [p["id"] for p in session_payloads] == [sid]  # user-b's session is not pushed

    chunk_calls = [kw for url, kw in post.calls if url.endswith("/document_chunks")]
    assert len(chunk_calls) == 1  # both chunks of the session go in one request
    assert sorted(r["chunk_index"] for r in chunk_calls[0]["json"]) == [0, 1]

    assert all(kw["headers"]["Authorization"] == "Bearer token-a" for _, kw in post.calls)
    assert redis_client.get_session(sid)["synced"] == "True"
    assert redis_client.client.hget("message:m1", "synced") == "True"
    assert redis_client.get_unsynced_chunks() == []
    assert redis_client.get_session(other)["synced"] == "False"


def test_sync_keeps_items_queued_when_supabase_rejects_them(monkeypatch):
    sid = _seed_user_a()
    monkeypatch.setattr(requests, "post", Recorder(500))
    sync_user_data("user-a", "token-a")
    assert redis_client.get_session(sid)["synced"] == "False"
    assert len(redis_client.get_unsynced_chunks()) == 2


def test_sync_does_nothing_without_pending_changes(monkeypatch):
    post = Recorder(201)
    monkeypatch.setattr(requests, "post", post)
    sync_user_data("user-a", "token-a")
    assert post.calls == []


def test_sync_survives_being_offline():
    sid = _seed_user_a()
    sync_user_data("user-a", "token-a")  # network disabled by conftest; must not raise
    assert redis_client.get_session(sid)["synced"] == "False"


def test_pending_deletion_is_sent_children_first_and_cleared(monkeypatch):
    sid = str(uuid.uuid4())
    redis_client.client.set(f"deleted_session:{sid}", "user-a")
    redis_client.client.set("deleted_session:someone-else", "user-b")

    delete = Recorder(204)
    monkeypatch.setattr(requests, "delete", delete)
    sync_user_data("user-a", "token-a")

    tables = [url.rsplit("/", 1)[1] for url in delete.urls()]
    assert tables == ["document_chunks", "chat_messages", "sessions"]
    assert redis_client.client.get(f"deleted_session:{sid}") is None
    assert redis_client.client.get("deleted_session:someone-else") == "user-b"


def test_failed_cloud_deletion_keeps_the_tombstone(monkeypatch):
    sid = str(uuid.uuid4())
    redis_client.client.set(f"deleted_session:{sid}", "user-a")
    monkeypatch.setattr(requests, "delete", Recorder(500))
    sync_user_data("user-a", "token-a")
    assert redis_client.client.get(f"deleted_session:{sid}") == "user-a"


def test_sync_endpoint_runs_for_the_signed_in_user(client, monkeypatch):
    sid = _seed_user_a()
    monkeypatch.setattr(requests, "post", Recorder(201))
    res = client.post("/sync")
    assert res.status_code == 200
    assert res.json()["user_id"] == "user-a"
    assert redis_client.get_session(sid)["synced"] == "True"


def test_session_list_merges_cloud_sessions_but_not_deleted_ones(client, monkeypatch):
    new_id, deleted_id = str(uuid.uuid4()), str(uuid.uuid4())
    redis_client.client.set(f"deleted_session:{deleted_id}", "user-a")
    cloud = [
        {"id": new_id, "session_title": "t1", "created_at": "2026-02-01T00:00:00Z"},
        {"id": deleted_id, "session_title": "t2", "created_at": "2026-02-02T00:00:00Z"},
    ]
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, cloud))

    ids = [s["id"] for s in client.get("/sessions").json()]
    assert ids == [new_id]


def test_session_list_works_offline_from_cache(client):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01T00:00:00.000Z", synced=True)
    res = client.get("/sessions")
    assert res.status_code == 200
    assert [s["id"] for s in res.json()] == [sid]


def test_cloud_messages_are_merged_in_time_order(client, monkeypatch):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01T00:00:00.000Z", synced=True)
    cloud = [
        {"id": "late", "sender": "assistant", "message_text": "2", "created_at": "2026-01-01T10:00:05+00:00"},
        {"id": "early", "sender": "user", "message_text": "1", "created_at": "2026-01-01T10:00:00+00:00"},
    ]
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, cloud))

    ids = [m["id"] for m in client.get(f"/sessions/{sid}/messages").json()]
    assert ids == ["early", "late"]


def test_new_message_is_marked_synced_when_cloud_accepts_it(client, monkeypatch):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01T00:00:00.000Z", synced=True)
    monkeypatch.setattr(requests, "post", Recorder(201))
    res = client.post("/messages", json={
        "id": "m-new", "session_id": sid, "sender": "assistant",
        "message_text": "ciphertext", "created_at": "2026-01-01T00:00:00Z",
    })
    assert res.status_code == 200
    assert redis_client.client.hget("message:m-new", "synced") == "True"


def test_message_with_unknown_sender_is_rejected(client):
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01T00:00:00.000Z", synced=True)
    res = client.post("/messages", json={
        "id": "m", "session_id": sid, "sender": "system",
        "message_text": "x", "created_at": "2026-01-01T00:00:00Z",
    })
    assert res.status_code == 422
