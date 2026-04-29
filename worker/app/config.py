import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    model_primary: str = os.getenv("ANTHROPIC_MODEL_PRIMARY", "claude-sonnet-4-5-20250929")
    model_fallback: str = os.getenv("ANTHROPIC_MODEL_FALLBACK", "claude-3-5-sonnet-20241022")
    supabase_url: str = os.getenv("SUPABASE_URL", "")
    supabase_service_role: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    worker_secret: str = os.getenv("WORKER_SHARED_SECRET", "")
    outputs_bucket: str = os.getenv("OUTPUTS_BUCKET", "outputs")
    work_root: str = os.getenv("WORK_ROOT", "/tmp/clarivo")
    chunk_pages: int = int(os.getenv("CHUNK_PAGES", "30"))
    chunk_timeout_s: int = int(os.getenv("CHUNK_TIMEOUT_S", "90"))
    chunk_retries: int = int(os.getenv("CHUNK_RETRIES", "5"))
    chunk_delay_s: float = float(os.getenv("CHUNK_DELAY_S", "2.5"))

settings = Settings()