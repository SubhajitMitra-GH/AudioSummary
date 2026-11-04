"""Test setup: fake config, stand-ins for heavy ML libraries, fake Redis, and no real network."""
import os
import sys
import types

import pytest

os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("BACKEND_ENCRYPTION_KEY", "test-encryption-key")
# Environment variables win over backend/.env, so a developer's local .env can't change test results.
os.environ.setdefault("LLM_MODEL", "llama3.2:3b")


def _stub_module(name: str, **attrs):
    module = types.ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class _FakeWhisperModel:
    def __init__(self, *args, **kwargs):
        pass


class _FakeSentenceTransformer:
    def __init__(self, *args, **kwargs):
        pass

    def encode(self, texts):
        import numpy as np
        return np.zeros((len(texts), 384), dtype="float32")


class _FakeOllama:
    last_model = None

    def __init__(self, *args, **kwargs):
        _FakeOllama.last_model = kwargs.get("model")

    def invoke(self, prompt):
        return "stub answer"


# Replace heavy libraries so tests don't need Whisper/Torch/LangChain models installed.
_stub_module("faster_whisper", WhisperModel=_FakeWhisperModel)
_stub_module("sentence_transformers", SentenceTransformer=_FakeSentenceTransformer)
_stub_module("langchain_community")
_stub_module("langchain_community.llms", Ollama=_FakeOllama)

import fakeredis  # noqa: E402
import requests  # noqa: E402

from app.redis_client import redis_client  # noqa: E402
from app import auth  # noqa: E402


@pytest.fixture(autouse=True)
def fake_redis():
    server = fakeredis.FakeServer()
    redis_client.client = fakeredis.FakeRedis(server=server, decode_responses=True)
    redis_client.raw_client = fakeredis.FakeRedis(server=server, decode_responses=False)
    yield redis_client.client
    redis_client.client = None
    redis_client.raw_client = None


@pytest.fixture(autouse=True)
def offline_by_default(monkeypatch):
    """Any HTTP call a test didn't explicitly mock behaves as if the internet is down."""
    def offline(*args, **kwargs):
        raise requests.ConnectionError("network disabled in tests")

    for name in ("get", "post", "patch", "delete"):
        monkeypatch.setattr(requests, name, offline)


@pytest.fixture(autouse=True)
def reset_jwks_cache():
    auth.jwks_cache._keys = {}
    auth.jwks_cache._fetched_at = 0.0
    auth.jwks_cache._last_attempt = 0.0
    yield


class FakeResponse:
    def __init__(self, status_code=200, json_data=None, headers=None, body=b""):
        self.status_code = status_code
        self._json = json_data
        self.headers = headers or {}
        self._body = body
        self.text = ""

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f"HTTP {self.status_code}")

    @property
    def is_redirect(self):
        return self.status_code in (301, 302, 303, 307, 308) and "Location" in self.headers

    def iter_lines(self):
        for line in self._body.split(b"\n"):
            yield line

    def iter_content(self, chunk_size=8192):
        for i in range(0, len(self._body), chunk_size):
            yield self._body[i:i + chunk_size]

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False
