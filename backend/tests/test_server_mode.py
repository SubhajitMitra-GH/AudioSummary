"""Shared online server (SERVER_MODE=true): fixed model, health waits for Ollama, website origin allowed."""
import re

import pytest
import requests
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.config import Settings, settings
from app.main import app
from tests.conftest import FakeResponse

USER = {"user": {"id": "user-a", "email": "a@example.com"}, "token": "tok"}


@pytest.fixture
def server(monkeypatch):
    monkeypatch.setattr(settings, "server_mode", True)
    app.dependency_overrides[get_current_user] = lambda: USER
    yield TestClient(app)
    app.dependency_overrides.clear()


def ollama_up(monkeypatch, *names):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, {"models": [{"name": n} for n in names]}))


def test_health_waits_for_ollama_on_the_server(server):
    assert server.get("/health").json()["status"] == "degraded"  # Redis up, Ollama not answering yet


def test_health_is_ready_once_ollama_answers(server, monkeypatch):
    ollama_up(monkeypatch, settings.llm_model)
    assert server.get("/health").json()["status"] == "healthy"


def test_desktop_health_does_not_need_ollama(monkeypatch):
    monkeypatch.setattr(settings, "server_mode", False)
    assert TestClient(app).get("/health").json()["status"] == "healthy"


@pytest.mark.parametrize("method,path,body", [
    ("put", "/models/active", {"model": "llama3.2:1b"}),
    ("post", "/ollama/install", None),
    ("post", "/ollama/pull", None),
])
def test_users_cannot_change_the_servers_model(server, method, path, body):
    res = getattr(server, method)(path, json=body) if body else getattr(server, method)(path)
    assert res.status_code == 403


def test_server_lists_only_its_model(server, monkeypatch):
    ollama_up(monkeypatch, settings.llm_model)
    body = server.get("/models").json()
    assert body["server_mode"] is True
    assert [m["id"] for m in body["models"]] == [settings.llm_model]


@pytest.mark.parametrize("origin,allowed", [
    ("https://subhajitmitra-gh.github.io", True),
    ("app://index.html", True),
    ("https://evil.example", False),
    ("https://subhajitmitra-gh.github.io.evil.example", False),
])
def test_server_cors_allows_the_website(origin, allowed):
    # Same value as server/start.sh's CORS_ORIGIN_REGEX.
    regex = open("../server/start.sh").read().split("CORS_ORIGIN_REGEX='", 1)[1].split("'", 1)[0]
    assert bool(re.match(regex, origin)) is allowed
    assert Settings(_env_file=None, cors_origin_regex=regex).cors_origin_regex == regex
