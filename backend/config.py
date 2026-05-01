from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    supabase_url: str = ""
    supabase_service_key: str = ""
    encryption_key: str = ""
    app_url: str = "http://localhost:8000"
    port: int = 8000
    environment: str = "development"
    gemini_api_key: str = ""       # platform-level key, no per-agent Gemini key needed
    openai_api_key: str = ""       # platform-level key for KB embeddings (text-embedding-3-small)
    deepgram_api_key: str = ""     # platform-level Deepgram key for STT
    allowed_origins: str = ""      # comma-separated allowed origins; empty = localhost only

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()
