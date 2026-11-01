"""Small helpers for calling Supabase's REST (PostgREST) API as the signed-in user."""
from app.config import settings


def rest_url(table: str) -> str:
    return f"{settings.supabase_url.rstrip('/')}/rest/v1/{table}"


def user_headers(token: str, json_body: bool = False, prefer: str | None = None) -> dict:
    """Headers that make Supabase apply Row Level Security as the user who owns `token`."""
    headers = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {token}",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    return headers
