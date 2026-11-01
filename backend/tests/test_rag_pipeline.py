"""B5/B8/S7: chunk numbering, cloud embedding parsing, and user-scoped search."""
import uuid

import pytest

from app.rag_pipeline import RAGPipeline, decrypt_data, parse_embedding
from app.redis_client import redis_client


@pytest.fixture
def pipeline(monkeypatch):
    p = RAGPipeline()
    monkeypatch.setattr(p, "generate_embeddings", lambda chunks: [[0.1] * 384 for _ in chunks])
    monkeypatch.setattr(redis_client, "create_vector_index", lambda dim=384: None)
    monkeypatch.setattr(p, "chunk_text", lambda text, **kw: text.split("|"))
    return p


def test_parse_embedding_accepts_pgvector_strings_and_lists():
    assert parse_embedding("[0.5,1,2]") == [0.5, 1.0, 2.0]
    assert parse_embedding([0.5, 1, 2]) == [0.5, 1.0, 2.0]


def test_second_source_does_not_overwrite_the_first(pipeline):
    sid = str(uuid.uuid4())
    pipeline.ingest_audio_transcript(sid, "a0|a1|a2", token="t", user_id="user-a")
    pipeline.ingest_audio_transcript(sid, "b0|b1", token="t", user_id="user-a")

    keys = sorted(redis_client.session_chunk_keys(sid), key=lambda k: int(k.rsplit(":", 1)[1]))
    assert len(keys) == 5
    contents = [decrypt_data(redis_client.client.hget(k, "content")) for k in keys]
    assert contents == ["a0", "a1", "a2", "b0", "b1"]


def test_unsynced_chunks_are_queued_when_offline(pipeline):
    sid = str(uuid.uuid4())
    pipeline.ingest_audio_transcript(sid, "x|y", token="t", user_id="user-a")
    queued = redis_client.get_unsynced_chunks()
    assert {c["chunk_index"] for c in queued} == {0, 1}
    assert all(len(c["embedding"]) == 384 for c in queued)


def test_search_is_always_scoped_to_user_and_session(monkeypatch):
    captured = {}

    class FakeIndex:
        def search(self, query, query_params=None):
            captured["query"] = query.query_string()

            class Result:
                docs = []
            return Result()

    monkeypatch.setattr(redis_client.client, "ft", lambda name: FakeIndex(), raising=False)
    monkeypatch.setattr(redis_client, "create_vector_index", lambda dim=384: None)
    p = RAGPipeline()
    sid = str(uuid.uuid4())
    p.retrieve_context("question", token="t", user_id="user-a", audio_id=sid)

    assert "@user_id:{user\\-a}" in captured["query"]
    assert "@session_id:{" in captured["query"]
