"""Choosing the local AI model: catalog, persistence, install detection and use in answers."""
import pytest
import requests
from fastapi.testclient import TestClient

import sys

from app import llm_models
from app.auth import get_current_user
from app.config import Settings, settings
from app.llm_models import (ACTIVE_MODEL_KEY, available_models, get_active_model, is_installed,
                            set_active_model)
from app.main import app
from app.rag_pipeline import RAGPipeline
from app.redis_client import redis_client
from tests.conftest import FakeResponse

USER_A = {"user": {"id": "user-a", "email": "a@example.com"}, "token": "token-a"}


@pytest.fixture
def client():
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def signed_in():
    app.dependency_overrides[get_current_user] = lambda: USER_A


@pytest.fixture
def ollama_has(monkeypatch):
    """Pretend Ollama is running with the given models downloaded."""
    def install(*names):
        tags = {"models": [{"name": n} for n in names]}
        monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, tags))
    return install


def test_small_model_is_the_default():
    assert Settings(_env_file=None).llm_model == "llama3.2:3b"
    assert get_active_model() == settings.llm_model


def test_catalog_offers_fast_balanced_and_best_quality():
    ids = [m.id for m in available_models()]
    assert ids == ["llama3.2:1b", "llama3.2:3b", "mistral"]
    assert [m.id for m in available_models() if m.recommended] == ["llama3.2:3b"]


def test_custom_env_model_is_offered(monkeypatch):
    monkeypatch.setattr(settings, "llm_model", "qwen2.5:3b")
    assert available_models()[-1].id == "qwen2.5:3b"
    assert get_active_model() == "qwen2.5:3b"


def test_selection_is_remembered():
    set_active_model("mistral")
    assert redis_client.client.get(ACTIVE_MODEL_KEY) == "mistral"
    assert get_active_model() == "mistral"


def test_unknown_selection_is_rejected_and_stale_values_ignored():
    with pytest.raises(ValueError):
        set_active_model("evil-model")
    redis_client.client.set(ACTIVE_MODEL_KEY, "model-removed-from-catalog")
    assert get_active_model() == settings.llm_model


def test_active_model_falls_back_when_redis_is_down(monkeypatch):
    import redis

    def down(*a, **k):
        raise redis.ConnectionError()
    monkeypatch.setattr(redis_client.client, "get", down)
    assert get_active_model() == settings.llm_model


@pytest.mark.parametrize("model_id,names,expected", [
    ("mistral", ["mistral:latest"], True),
    ("mistral", ["mistral:7b"], True),
    ("mistral", ["mistral-nemo:latest"], False),
    ("llama3.2:3b", ["llama3.2:3b"], True),
    ("llama3.2:3b", ["llama3.2:1b"], False),
    ("llama3.2:1b", [], False),
])
def test_install_detection(model_id, names, expected):
    assert is_installed(model_id, names) is expected


def test_models_endpoint_reports_installed_and_active(client, ollama_has):
    ollama_has("llama3.2:1b", "mistral:latest")
    set_active_model("llama3.2:1b")
    body = client.get("/models").json()
    assert body["active"] == "llama3.2:1b"
    assert body["ollama_running"] is True
    by_id = {m["id"]: m for m in body["models"]}
    assert by_id["llama3.2:1b"]["installed"] and by_id["llama3.2:1b"]["active"]
    assert by_id["mistral"]["installed"] and not by_id["mistral"]["active"]
    assert not by_id["llama3.2:3b"]["installed"]
    assert by_id["llama3.2:3b"]["label"] == "Balanced"


def test_models_endpoint_when_ollama_is_off(client):
    body = client.get("/models").json()
    assert body["ollama_running"] is False
    assert not any(m["installed"] for m in body["models"])


def test_selecting_a_model_requires_login(client):
    assert client.put("/models/active", json={"model": "mistral"}).status_code in (401, 403)


def test_selecting_a_model(client, signed_in):
    res = client.put("/models/active", json={"model": "llama3.2:1b"})
    assert res.status_code == 200
    assert res.json()["active"] == "llama3.2:1b"
    assert get_active_model() == "llama3.2:1b"


def test_selecting_an_unknown_model_is_rejected(client, signed_in):
    res = client.put("/models/active", json={"model": "../../etc/passwd"})
    assert res.status_code == 400
    assert get_active_model() == settings.llm_model


def test_status_follows_the_selected_model(client, ollama_has):
    ollama_has("llama3.2:3b")
    assert client.get("/ollama/status").json()["model_pulled"] is True
    set_active_model("mistral")
    body = client.get("/ollama/status").json()
    assert body["configured_model"] == "mistral"
    assert body["model_pulled"] is False  # switching to a model that isn't downloaded yet


def test_pull_downloads_the_selected_model(client, signed_in, monkeypatch):
    set_active_model("llama3.2:1b")
    sent = {}

    def fake_post(url, json=None, **kwargs):
        sent["json"] = json
        return FakeResponse(200, body=b'{"status":"success"}')
    monkeypatch.setattr(requests, "post", fake_post)
    client.post("/ollama/pull")
    assert sent["json"] == {"name": "llama3.2:1b"}


def test_answers_use_the_selected_model(monkeypatch):
    set_active_model("mistral")
    p = RAGPipeline()
    monkeypatch.setattr(p, "retrieve_context", lambda *a, **k: [])
    p.answer_question("q", token="t", user_id="u", audio_id="s")
    fake_ollama = sys.modules["langchain_community.llms"].Ollama
    assert fake_ollama.last_model == "mistral"
