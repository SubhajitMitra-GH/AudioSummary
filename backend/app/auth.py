"""Authentication and session-ownership checks.

Tokens are verified by signature against Supabase's published signing keys (JWKS).
The keys are public, cached in memory and in Redis, so verification also works offline.
A token is never trusted without a valid signature.
"""
import json
import logging
import threading
import time
import uuid

import jwt
import redis
import requests
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings
from app.redis_client import redis_client
from app.supabase_rest import rest_url, user_headers

logger = logging.getLogger("uvicorn.error")

security = HTTPBearer()

ASYMMETRIC_ALGORITHMS = {"RS256", "ES256"}
JWKS_REDIS_KEY = "supabase:jwks"
JWKS_REFRESH_SECONDS = 600
JWKS_MIN_RETRY_SECONDS = 30


class _JwksCache:
    """Caches Supabase's public signing keys in memory and in Redis (for offline use)."""

    def __init__(self):
        self._keys: dict[str, dict] = {}
        self._fetched_at = 0.0
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    def _jwks_url(self) -> str:
        return f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    def _store(self, jwks: dict):
        self._keys = {k["kid"]: k for k in jwks.get("keys", []) if k.get("kid")}

    def _fetch(self) -> bool:
        self._last_attempt = time.time()
        try:
            res = requests.get(self._jwks_url(), timeout=5)
            res.raise_for_status()
            jwks = res.json()
        except (requests.RequestException, ValueError) as e:
            logger.warning(f"Could not fetch Supabase signing keys: {e}")
            return False
        self._store(jwks)
        self._fetched_at = time.time()
        try:
            redis_client.client.set(JWKS_REDIS_KEY, json.dumps(jwks))
        except (redis.RedisError, AttributeError):
            pass
        return True

    def _load_from_redis(self):
        try:
            raw = redis_client.client.get(JWKS_REDIS_KEY)
        except (redis.RedisError, AttributeError):
            return
        if raw:
            self._store(json.loads(raw))

    def get(self, kid: str) -> dict | None:
        with self._lock:
            now = time.time()
            stale = now - self._fetched_at > JWKS_REFRESH_SECONDS
            missing = kid not in self._keys
            if (stale or missing) and now - self._last_attempt > JWKS_MIN_RETRY_SECONDS:
                if not self._fetch() and not self._keys:
                    self._load_from_redis()
            if kid not in self._keys and not self._keys:
                self._load_from_redis()
            return self._keys.get(kid)


jwks_cache = _JwksCache()


def _unauthorized(detail: str = "Invalid or expired session. Please sign in again.") -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _verify_with_signing_key(token: str, alg: str, jwk: dict) -> dict:
    key = jwt.PyJWK(jwk, algorithm=alg).key
    return jwt.decode(
        token,
        key,
        algorithms=[alg],
        audience="authenticated",
        issuer=f"{settings.supabase_url.rstrip('/')}/auth/v1",
        options={"require": ["exp", "sub"]},
    )


def _verify_online(token: str) -> dict:
    """Ask Supabase directly. Used for projects that still sign tokens with a shared secret (HS256)."""
    try:
        res = requests.get(
            f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
            headers=user_headers(token),
            timeout=5,
        )
    except requests.RequestException:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Can't verify your session while offline. Reconnect to the internet and try again.",
        )
    if res.status_code != 200:
        logger.info(f"Supabase rejected a session token (status {res.status_code}).")
        raise _unauthorized()
    user = res.json()
    return {"sub": user["id"], "email": user.get("email")}


def verify_access_token(token: str) -> dict:
    """Return the verified token claims (at least `sub`), or raise 401/503."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized()

    alg = header.get("alg")
    kid = header.get("kid")
    if alg in ASYMMETRIC_ALGORITHMS and kid:
        jwk = jwks_cache.get(kid)
        if jwk is not None:
            try:
                return _verify_with_signing_key(token, alg, jwk)
            except jwt.PyJWTError as e:
                logger.info(f"Rejected session token: {e}")
                raise _unauthorized()
        # Unknown key id and keys could not be refreshed: fall through to the online check.

    if alg not in ASYMMETRIC_ALGORITHMS | {"HS256"}:
        raise _unauthorized()
    return _verify_online(token)


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    if not settings.supabase_url or not settings.supabase_anon_key:
        logger.error("Supabase config is missing on backend (SUPABASE_URL / SUPABASE_ANON_KEY).")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication is not configured on the server.",
        )
    token = credentials.credentials
    claims = verify_access_token(token)
    return {"user": {"id": claims["sub"], "email": claims.get("email")}, "token": token}


def validate_session_id(session_id: str) -> str:
    """Session IDs are client-generated UUIDs. Rejecting anything else also keeps them safe to
    embed in Redis keys, search queries and PostgREST filters."""
    try:
        return str(uuid.UUID(session_id))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid session id.")


def verify_session_ownership(session_id: str, user_id: str, token: str, allow_new: bool) -> None:
    """Raise 403 if the session belongs to someone else, 404 if it doesn't exist (and allow_new is False).

    Checks the local Redis cache first, then Supabase using the user's own token, so Row Level
    Security decides what is visible. The anonymous key is never used for this.
    """
    try:
        owner = redis_client.get_session_owner(session_id)
    except redis.RedisError:
        owner = None
    if owner is not None:
        if owner != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to session.")
        return

    try:
        res = requests.get(
            rest_url("sessions"),
            headers=user_headers(token),
            params={"id": f"eq.{session_id}", "select": "id,user_id"},
            timeout=5,
        )
    except requests.RequestException:
        # Offline and not cached locally: only a brand-new session can be accepted.
        if allow_new:
            return
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

    if res.status_code != 200:
        logger.error(f"Session ownership check failed: Supabase status {res.status_code}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not verify access to this session."
        )

    rows = res.json()
    if rows:
        if str(rows[0].get("user_id")) != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to session.")
        return
    if not allow_new:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")
