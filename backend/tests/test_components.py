"""Unit tests for config, encryption, Redis index handling, cloud restore, auth edge cases and Whisper wrapper."""
import re
import time
import uuid

import jwt
import pytest
import requests
from fastapi import HTTPException

from app import auth
from app.audio_processor import AudioProcessor
from app.config import DEFAULT_BACKEND_ENCRYPTION_KEY, Settings, settings
from app.rag_pipeline import RAGPipeline, decrypt_data, encrypt_data, escape_tag
from app.redis_client import redis_client
from tests.conftest import FakeResponse


# --- config ---

@pytest.mark.parametrize("origin,allowed", [
    ("app://index.html", True),
    ("http://localhost:3000", True),
    ("http://127.0.0.1:3000", True),
    ("https://evil.example", False),
    ("http://localhost.evil.example", False),
    ("http://evil.example/?http://localhost:3000", False),
])
def test_cors_origin_regex(origin, allowed):
    assert bool(re.match(Settings(_env_file=None).cors_origin_regex, origin)) is allowed


def test_default_encryption_key_is_flagged():
    s = Settings(_env_file=None, backend_encryption_key=DEFAULT_BACKEND_ENCRYPTION_KEY)
    assert s.using_default_encryption_key
    assert not Settings(_env_file=None, backend_encryption_key="real-key").using_default_encryption_key


def test_max_upload_bytes():
    assert Settings(_env_file=None, max_upload_mb=2).max_upload_bytes == 2 * 1024 * 1024


# --- encryption ---

def test_encrypt_decrypt_roundtrip():
    secret = "Meeting with John at 5pm"
    ciphertext = encrypt_data(secret)
    assert ciphertext != secret
    assert decrypt_data(ciphertext) == secret


def test_encrypting_twice_gives_different_ciphertext():
    assert encrypt_data("same") != encrypt_data("same")


def test_decrypting_garbage_does_not_crash():
    assert decrypt_data("not-a-fernet-token") == "[Decryption Error]"
    assert decrypt_data("") == ""


def test_escape_tag_escapes_uuid_hyphens():
    assert escape_tag("ab-cd") == "ab\\-cd"


# --- redis index ---

class FakeIndex:
    def __init__(self, fields):
        self.fields = fields
        self.dropped = False
        self.created = False

    def info(self):
        if self.fields is None:
            raise Exception("Unknown index name")
        return {"attributes": [["identifier", f, "attribute", f] for f in self.fields]}

    def dropindex(self, delete_documents=False):
        self.dropped = True

    def create_index(self, schema, definition):
        self.created = True


@pytest.mark.parametrize("fields,dropped,created", [
    (["session_id", "user_id", "content", "embedding"], False, False),  # up to date
    (["session_id", "content", "embedding"], True, True),               # missing user_id -> rebuild
    (None, False, True),                                                # no index yet
])
def test_vector_index_is_created_or_rebuilt(monkeypatch, fields, dropped, created):
    index = FakeIndex(fields)
    monkeypatch.setattr(redis_client.client, "ft", lambda name: index, raising=False)
    redis_client.create_vector_index()
    assert index.dropped is dropped
    assert index.created is created


def test_ping_returns_false_without_client():
    saved = redis_client.client
    redis_client.client = None
    try:
        assert redis_client.ping() is False
    finally:
        redis_client.client = saved


def test_tombstones_are_filtered_by_user():
    redis_client.client.set("deleted_session:s1", "user-a")
    redis_client.client.set("deleted_session:s2", "user-b")
    assert redis_client.get_deletion_tombstones("user-a") == ["s1"]


def test_delete_session_removes_everything_locally():
    sid = str(uuid.uuid4())
    redis_client.save_session(sid, "user-a", "t", "2026-01-01", synced=True)
    redis_client.save_message("m1", sid, "user", "x", "2026-01-01", 1.0)
    redis_client.save_chunk(sid, 0, "c", [0.0] * 384, "user-a")
    redis_client.delete_session(sid)
    assert redis_client.get_session(sid) is None
    assert redis_client.get_session_messages(sid) == []
    assert redis_client.session_chunk_keys(sid) == []
    assert sid not in redis_client.client.smembers("user_sessions:user-a")


# --- cloud restore ---

def test_restore_parses_pgvector_strings(monkeypatch):
    sid = str(uuid.uuid4())
    rows = [
        {"session_id": sid, "chunk_index": 0, "content": "enc", "embedding": "[" + ",".join(["0.5"] * 384) + "]", "user_id": "user-a"},
        {"session_id": sid, "chunk_index": 1, "content": "enc"},  # malformed: skipped
    ]
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, rows))
    assert RAGPipeline().restore_chunks_from_cloud(sid, "tok") == 1
    assert redis_client.client.hget(f"chunk:{sid}:0", "synced") == "True"


def test_restore_is_skipped_when_chunks_exist_locally(monkeypatch):
    sid = str(uuid.uuid4())
    redis_client.save_chunk(sid, 0, "c", [0.0] * 384, "user-a")
    calls = []
    monkeypatch.setattr(requests, "get", lambda *a, **k: calls.append(1) or FakeResponse(200, []))
    assert RAGPipeline().restore_chunks_from_cloud(sid, "tok") == 0
    assert calls == []


def test_restore_offline_returns_zero():
    assert RAGPipeline().restore_chunks_from_cloud(str(uuid.uuid4()), "tok") == 0


def test_answer_question_uses_retrieved_context(monkeypatch):
    p = RAGPipeline()
    monkeypatch.setattr(p, "retrieve_context", lambda *a, **k: [{"chunk_index": 0, "content": "ctx", "audio_id": "s", "score": 0.1}])
    result = p.answer_question("q", token="t", user_id="u", audio_id="s")
    assert result["answer"] == "stub answer"
    assert result["context"][0]["content"] == "ctx"


# --- auth edge cases ---

def _hs256_token():
    return jwt.encode({"sub": "u1", "aud": "authenticated", "exp": int(time.time()) + 60},
                      "x" * 32, algorithm="HS256")


def test_hs256_token_is_accepted_when_supabase_confirms_it(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, {"id": "u1", "email": "u1@example.com"}))
    assert auth.verify_access_token(_hs256_token()) == {"sub": "u1", "email": "u1@example.com"}


def test_hs256_token_is_rejected_when_supabase_rejects_it(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(401, {}))
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(_hs256_token())
    assert exc.value.status_code == 401


def test_missing_supabase_config_is_a_server_error(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")

    class Creds:
        credentials = "tok"
    with pytest.raises(HTTPException) as exc:
        auth.get_current_user(Creds())
    assert exc.value.status_code == 500


def test_jwks_fetch_is_rate_limited_after_a_failure(monkeypatch):
    calls = []

    def offline(*a, **k):
        calls.append(1)
        raise requests.ConnectionError()
    monkeypatch.setattr(requests, "get", offline)
    assert auth.jwks_cache.get("kid-1") is None
    assert auth.jwks_cache.get("kid-1") is None
    assert len(calls) == 1


def test_unknown_key_id_triggers_a_refresh(monkeypatch):
    auth.jwks_cache._keys = {"old": {"kid": "old"}}
    auth.jwks_cache._fetched_at = time.time()
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, {"keys": [{"kid": "new", "kty": "EC"}]}))
    assert auth.jwks_cache.get("new") == {"kid": "new", "kty": "EC"}


# --- whisper wrapper ---

def test_transcribe_requires_a_loaded_model(tmp_path):
    with pytest.raises(RuntimeError):
        AudioProcessor().transcribe(str(tmp_path / "a.mp3"))


def test_transcribe_requires_an_existing_file(tmp_path):
    p = AudioProcessor()
    p.model = object()
    with pytest.raises(FileNotFoundError):
        p.transcribe(str(tmp_path / "missing.mp3"))


def test_transcribe_joins_segments(tmp_path):
    class Seg:
        def __init__(self, start, end, text):
            self.start, self.end, self.text = start, end, text

    class Info:
        language = "en"
        language_probability = 0.9

    class Model:
        def transcribe(self, path, beam_size, vad_filter):
            return iter([Seg(0, 1.234, " Hello"), Seg(1.234, 2, " world ")]), Info()

    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    p = AudioProcessor()
    p.model = Model()
    result = p.transcribe(str(f))
    assert result["text"] == "Hello  world"
    assert result["segments"][0] == {"start": 0, "end": 1.23, "text": "Hello"}
    assert result["language"] == "en"
