"""S2/S5: tokens are only accepted with a valid signature; ownership uses the user's own token."""
import json
import time
import uuid

import jwt
import pytest
import requests
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException
from jwt.algorithms import ECAlgorithm

from app import auth
from app.config import settings
from app.redis_client import redis_client
from tests.conftest import FakeResponse

KID = "test-key-1"
ISSUER = f"{settings.supabase_url}/auth/v1"


def _make_key():
    private = ec.generate_private_key(ec.SECP256R1())
    public_jwk = json.loads(ECAlgorithm.to_jwk(private.public_key()))
    public_jwk.update({"kid": KID, "alg": "ES256", "use": "sig"})
    return private, public_jwk


PRIVATE_KEY, PUBLIC_JWK = _make_key()


def make_token(private_key=PRIVATE_KEY, **overrides):
    claims = {
        "sub": "user-a",
        "email": "a@example.com",
        "aud": "authenticated",
        "iss": ISSUER,
        "exp": int(time.time()) + 3600,
    }
    claims.update(overrides)
    return jwt.encode(claims, private_key, algorithm="ES256", headers={"kid": KID})


@pytest.fixture
def known_signing_key(monkeypatch):
    monkeypatch.setattr(auth.jwks_cache, "get", lambda kid: PUBLIC_JWK if kid == KID else None)


def test_valid_token_is_accepted_offline(known_signing_key):
    claims = auth.verify_access_token(make_token())
    assert claims["sub"] == "user-a"


def test_expired_token_is_rejected(known_signing_key):
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(make_token(exp=int(time.time()) - 10))
    assert exc.value.status_code == 401


def test_wrong_audience_is_rejected(known_signing_key):
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(make_token(aud="something-else"))
    assert exc.value.status_code == 401


def test_token_signed_by_another_key_is_rejected(known_signing_key):
    attacker_key, _ = _make_key()
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(make_token(private_key=attacker_key))
    assert exc.value.status_code == 401


def test_forged_hs256_token_is_not_trusted_when_offline():
    """Before the fix, an unsigned/forged token was accepted whenever Supabase was unreachable."""
    forged = jwt.encode({"sub": "victim", "aud": "authenticated", "exp": int(time.time()) + 3600},
                        "attacker-secret-attacker-secret-32", algorithm="HS256")
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(forged)
    assert exc.value.status_code == 503  # cannot verify offline -> refused, never accepted


def test_alg_none_token_is_rejected():
    unsigned = jwt.encode({"sub": "victim"}, None, algorithm="none")
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token(unsigned)
    assert exc.value.status_code == 401


def test_garbage_token_is_rejected():
    with pytest.raises(HTTPException) as exc:
        auth.verify_access_token("not-a-jwt")
    assert exc.value.status_code == 401


def test_jwks_are_cached_in_redis_for_offline_use(monkeypatch):
    jwks = {"keys": [PUBLIC_JWK]}
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, jwks))
    assert auth.jwks_cache.get(KID) == PUBLIC_JWK

    # Simulate an app restart while offline: memory cache empty, network down.
    def offline(*a, **k):
        raise requests.ConnectionError()
    monkeypatch.setattr(requests, "get", offline)
    auth.jwks_cache._keys = {}
    auth.jwks_cache._last_attempt = 0.0
    assert auth.jwks_cache.get(KID) == PUBLIC_JWK


# --- session ownership ---

SID = str(uuid.uuid4())


def _cache_session(owner: str):
    redis_client.save_session(SID, owner, "title", "2026-01-01T00:00:00.000Z", synced=True)


def test_invalid_session_id_is_rejected():
    with pytest.raises(HTTPException) as exc:
        auth.validate_session_id("chunk:*")
    assert exc.value.status_code == 400


def test_owner_from_local_cache_is_allowed():
    _cache_session("user-a")
    auth.verify_session_ownership(SID, "user-a", "tok", allow_new=False)


def test_other_users_local_session_is_forbidden():
    _cache_session("user-b")
    with pytest.raises(HTTPException) as exc:
        auth.verify_session_ownership(SID, "user-a", "tok", allow_new=True)
    assert exc.value.status_code == 403


def test_cloud_check_uses_the_users_own_token(monkeypatch):
    seen = {}

    def fake_get(url, headers=None, params=None, timeout=None):
        seen["auth"] = headers.get("Authorization")
        return FakeResponse(200, [{"id": SID, "user_id": "user-b"}])
    monkeypatch.setattr(requests, "get", fake_get)

    with pytest.raises(HTTPException) as exc:
        auth.verify_session_ownership(SID, "user-a", "user-a-token", allow_new=True)
    assert exc.value.status_code == 403
    assert seen["auth"] == "Bearer user-a-token"


def test_unknown_session_is_404_unless_new_allowed(monkeypatch):
    monkeypatch.setattr(requests, "get", lambda *a, **k: FakeResponse(200, []))
    auth.verify_session_ownership(SID, "user-a", "tok", allow_new=True)
    with pytest.raises(HTTPException) as exc:
        auth.verify_session_ownership(SID, "user-a", "tok", allow_new=False)
    assert exc.value.status_code == 404


def test_offline_unknown_session_is_404_unless_new_allowed():
    auth.verify_session_ownership(SID, "user-a", "tok", allow_new=True)
    with pytest.raises(HTTPException) as exc:
        auth.verify_session_ownership(SID, "user-a", "tok", allow_new=False)
    assert exc.value.status_code == 404
