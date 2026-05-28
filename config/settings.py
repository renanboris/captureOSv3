from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    # API
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    backend_url: str = "http://localhost:8000"  # Sobrescrever em produção

    # Storage
    storage_mode: str = "local"  # "local" | "s3" | "r2"
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    aws_access_key: str = ""
    aws_secret_key: str = ""
    r2_account_id: str = ""
    r2_endpoint: str = ""

    # IA
    google_api_key: str = ""
    openai_api_key: str = ""
    pinecone_api_key: str = ""
    pinecone_index_name: str = ""

    # Worker
    redis_url: str = "redis://localhost:6379"

    # Auth (Fase 2)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    jwt_secret: str = "dev-secret-change-in-prod"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()
