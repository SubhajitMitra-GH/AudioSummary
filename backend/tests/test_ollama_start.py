"""Ollama setup: start an Ollama that's already installed before downloading a new copy."""
import requests

from app import main


def _fake_paths(monkeypatch, apps=(), clis=()):
    monkeypatch.setattr(main, "OLLAMA_APP_PATHS", tuple(apps))
    monkeypatch.setattr(main, "OLLAMA_CLI_PATHS", tuple(clis))


def test_launches_installed_app(monkeypatch, tmp_path):
    app_dir = tmp_path / "Ollama.app"
    app_dir.mkdir()
    _fake_paths(monkeypatch, apps=[str(app_dir)])
    calls = []
    monkeypatch.setattr(main.subprocess, "Popen", lambda args, **kw: calls.append(args))
    monkeypatch.setattr(main, "_wait_for_ollama", lambda seconds: True)
    assert main.start_existing_ollama() is True
    assert calls == [["open", str(app_dir)]]


def test_starts_homebrew_cli(monkeypatch, tmp_path):
    cli = tmp_path / "ollama"
    cli.write_text("#!/bin/sh\n")
    cli.chmod(0o755)
    _fake_paths(monkeypatch, clis=[str(cli)])
    calls = []
    monkeypatch.setattr(main.subprocess, "Popen", lambda args, **kw: calls.append((args, kw.get("start_new_session"))))
    monkeypatch.setattr(main, "_wait_for_ollama", lambda seconds: True)
    assert main.start_existing_ollama() is True
    assert calls == [([str(cli), "serve"], True)]


def test_nothing_installed(monkeypatch):
    _fake_paths(monkeypatch)
    assert main.start_existing_ollama() is False


def test_installer_skips_download_when_existing_ollama_starts(monkeypatch):
    monkeypatch.setattr(main, "start_existing_ollama", lambda: True)

    def no_download(*a, **k):
        raise AssertionError("should not download")
    monkeypatch.setattr(requests, "get", no_download)
    main.download_and_install_ollama_bg()
    assert main.ollama_install_progress == {"status": "completed", "progress": 100}
