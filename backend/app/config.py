from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_password: Optional[str] = None
    port: int = 8000
    host: str = "0.0.0.0"
    llm_model: str = "mistral"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    backend_encryption_key: str = "default-fallback-key-for-transcripts-112233"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
