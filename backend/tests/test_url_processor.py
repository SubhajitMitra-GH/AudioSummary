"""S9: link downloads only reach public addresses, respect the size limit and reject web pages."""
import socket

import pytest
import requests

from app import url_processor
from app.url_processor import IngestError, is_youtube_url, validate_public_url
from tests.conftest import FakeResponse

PUBLIC_IP = "93.184.216.34"


@pytest.fixture
def fake_dns(monkeypatch):
    table = {"public.example": PUBLIC_IP, "internal.example": "10.0.0.5"}

    def getaddrinfo(host, port, *args, **kwargs):
        ip = table.get(host, host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]
    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://public.example/a.mp3", "javascript:alert(1)"])
def test_non_http_schemes_are_rejected(url, fake_dns):
    with pytest.raises(IngestError):
        validate_public_url(url)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/health",
    "http://192.168.1.10/a.mp3",
    "http://169.254.169.254/latest/meta-data",
    "http://internal.example/a.mp3",
    "http://[::1]/a.mp3",
])
def test_private_addresses_are_rejected(url, fake_dns):
    with pytest.raises(IngestError):
        validate_public_url(url)


def test_public_address_is_allowed(fake_dns):
    assert validate_public_url("https://public.example/a.mp3") == "https://public.example/a.mp3"


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", True),
    ("https://youtu.be/dQw4w9WgXcQ", True),
    ("https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ", False),
    ("https://youtube.com.evil.example/watch?v=x", False),
])
def test_youtube_detection_uses_the_hostname(url, expected):
    assert is_youtube_url(url) is expected


def test_redirect_to_private_address_is_blocked(fake_dns, monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(302, headers={"Location": "http://127.0.0.1/secret"}))
    with pytest.raises(IngestError):
        url_processor.download_audio_from_url("https://public.example/a.mp3", "/tmp/unused")


def test_web_pages_are_rejected_with_a_clear_message(fake_dns, monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, headers={"Content-Type": "text/html"}))
    with pytest.raises(IngestError, match="web page"):
        url_processor.download_audio_from_url("https://public.example/track", "/tmp/unused")


def test_download_stops_at_size_limit(fake_dns, monkeypatch, tmp_path):
    monkeypatch.setattr(url_processor.settings, "max_upload_mb", 0)
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(
        200, headers={"Content-Type": "audio/mpeg"}, body=b"x" * 100))
    with pytest.raises(IngestError, match="limit"):
        url_processor.download_audio_from_url("https://public.example/a.mp3", str(tmp_path / "out"))
    assert list(tmp_path.iterdir()) == []  # partial file removed


def test_direct_download_succeeds(fake_dns, monkeypatch, tmp_path):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(
        200, headers={"Content-Type": "audio/wav"}, body=b"RIFF....WAVE"))
    path = url_processor.download_audio_from_url("https://public.example/a", str(tmp_path / "out"))
    assert path.endswith(".wav")
    assert open(path, "rb").read() == b"RIFF....WAVE"
