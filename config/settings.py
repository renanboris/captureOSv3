from pydantic_settings import BaseSettings, SettingsConfigDict
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
    google_application_credentials: str = ""
    google_cloud_project: str = ""
    google_cloud_location: str = "us-central1"
    openai_api_key: str = ""
    pinecone_api_key: str = ""
    pinecone_index_name: str = ""

    # Worker
    redis_url: str = "redis://localhost:6379"

    # Auth (Fase 2)
    supabase_url: str = ""
    supabase_anon_key: str = ""
    jwt_secret: str = "dev-secret-change-in-prod"

    # CORS / Extension
    # Comma-separated allow-list of origins permitted to call the API.
    # Never combine a wildcard "*" with credentialed access (see cors_allowed_origins).
    allowed_origins: str = "http://localhost:8000"
    # The published Chrome extension ID, used to build the chrome-extension:// origin.
    extension_id: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def cors_allowed_origins(self) -> list[str]:
        """Build the explicit CORS allow-list.

        Combines the configured ``allowed_origins`` entries, the deployed
        ``backend_url`` host, and the ``chrome-extension://<extension_id>``
        origin. Any wildcard ("*") entry is intentionally dropped so the
        allow-list is never paired with ``allow_credentials=True``.
        """
        origins: list[str] = []

        def _add(origin: str) -> None:
            origin = origin.strip()
            if origin and origin != "*" and origin not in origins:
                origins.append(origin)

        # Explicit allow-list from settings (comma-separated).
        for entry in self.allowed_origins.split(","):
            _add(entry)

        # Deployed backend host.
        _add(self.backend_url)

        # Extension origin.
        if self.extension_id.strip():
            _add(f"chrome-extension://{self.extension_id.strip()}")

        return origins

@lru_cache()
def get_settings() -> Settings:
    return Settings()
