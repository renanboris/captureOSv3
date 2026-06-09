"""Factory for the google-genai Client.

Supports two authentication modes:
1. **Service Account JSON (Vertex AI)** — when GOOGLE_APPLICATION_CREDENTIALS is set.
   Loads credentials from the JSON file with cloud-platform scope and creates
   a Vertex AI client with project/location.
2. **API Key (Gemini Developer API)** — legacy fallback when GOOGLE_API_KEY is set.

Usage:
    from config.genai_client import get_genai_client
    client = get_genai_client()
"""

import os
import logging
from google import genai
from config.settings import get_settings

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]


def get_genai_client() -> genai.Client:
    """Return a configured genai.Client using the best available credentials."""
    settings = get_settings()

    # Priority 1: Service Account JSON → Vertex AI mode
    creds_path = settings.google_application_credentials
    if creds_path and os.path.exists(creds_path):
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_file(
            creds_path, scopes=_SCOPES
        )

        project_id = settings.google_cloud_project or ""
        location = settings.google_cloud_location or "us-central1"

        logger.info(f"genai Client: Vertex AI mode (project={project_id}, location={location})")
        return genai.Client(
            vertexai=True,
            credentials=credentials,
            project=project_id,
            location=location,
        )

    # Priority 2: API Key → Gemini Developer API mode (legacy)
    api_key = settings.google_api_key or os.getenv("GOOGLE_API_KEY", "")
    if api_key:
        logger.info("genai Client: API Key mode (Gemini Developer API)")
        return genai.Client(api_key=api_key)

    raise RuntimeError(
        "No Google AI credentials configured. Set GOOGLE_APPLICATION_CREDENTIALS "
        "(service account JSON) or GOOGLE_API_KEY in .env."
    )
