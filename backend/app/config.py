from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

# Built-in fallback key. Kept only so data already encrypted with it stays readable.
# Anything encrypted with this key is effectively unencrypted: the value is public in the source code.
DEFAULT_BACKEND_ENCRYPTION_KEY = "default-fallback-key-for-transcripts-112233"


class Settings(BaseSettings):
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: Optional[str] = None
    port: int = 8000
    # Loopback only. Binding to 0.0.0.0 would expose the API to every device on the network.
    host: str = "127.0.0.1"
    # Browser origins allowed to call the API: the packaged Electron app (app://) and the Next dev server.
    cors_origin_regex: str = r"^(app://.*|https?://(localhost|127\.0\.0\.1)(:\d+)?)$"
    llm_model: str = "mistral"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    backend_encryption_key: str = DEFAULT_BACKEND_ENCRYPTION_KEY
    # Maximum size of an uploaded or downloaded audio file.
    max_upload_mb: int = 200

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def using_default_encryption_key(self) -> bool:
        return self.backend_encryption_key == DEFAULT_BACKEND_ENCRYPTION_KEY


settings = Settings()
