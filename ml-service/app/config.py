from typing import Optional
from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ── Supabase Configuration ──────────────────────────────────────────────────
    supabase_url: str = Field("", validation_alias="SUPABASE_URL")
    # Prefer service role; accept several common env names without breaking if absent
    supabase_service_role_key: Optional[str] = Field(None, validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    supabase_service_key: Optional[str] = Field(None, validation_alias="SUPABASE_SERVICE_KEY")
    supabase_anon_key: Optional[str] = Field(None, validation_alias="SUPABASE_ANON_KEY")
    supabase_publishable_key: Optional[str] = Field(None, validation_alias="SUPABASE_PUBLISHABLE_KEY")
    supabase_project_id: Optional[str] = Field(None, validation_alias="SUPABASE_PROJECT_ID")

    # ── Service Configuration ──────────────────────────────────────────────────
    service_name: str = Field("simulation-service", validation_alias="SERVICE_NAME")
    service_version: str = Field("1.0.0", validation_alias="SERVICE_VERSION")
    debug: bool = Field(False, validation_alias="DEBUG")
    port: int = Field(8000, validation_alias="PORT")

    # ── Simulation Configuration ───────────────────────────────────────────────
    default_simulation_horizon_days: int = Field(30, validation_alias="DEFAULT_SIMULATION_HORIZON_DAYS")
    default_monte_carlo_runs: int = Field(1000, validation_alias="DEFAULT_MONTE_CARLO_RUNS")
    max_monte_carlo_runs: int = Field(10000, validation_alias="MAX_MONTE_CARLO_RUNS")
    cache_ttl_hours: int = Field(24, validation_alias="CACHE_TTL_HOURS")

    # ── Performance Configuration ──────────────────────────────────────────────
    max_workers: int = Field(4, validation_alias="MAX_WORKERS")
    job_timeout_minutes: int = Field(30, validation_alias="JOB_TIMEOUT_MINUTES")
    batch_size: int = Field(100, validation_alias="BATCH_SIZE")

    # ── Redis Configuration (for caching and job queue) ────────────────────────
    redis_url: Optional[str] = Field(None, validation_alias="REDIS_URL")
    redis_host: str = Field("localhost", validation_alias="REDIS_HOST")
    redis_port: int = Field(6379, validation_alias="REDIS_PORT")
    redis_db: int = Field(0, validation_alias="REDIS_DB")

    # ── Logging Configuration ──────────────────────────────────────────────────
    log_level: str = Field("INFO", validation_alias="LOG_LEVEL")
    structured_logging: bool = Field(True, validation_alias="STRUCTURED_LOGGING")

    # ── API Security ───────────────────────────────────────────────────────────
    api_key: Optional[str] = Field(None, validation_alias="SIMULATION_API_KEY")
    allowed_origins: str = Field("*", validation_alias="ALLOWED_ORIGINS")

    # ── Production settings ────────────────────────────────────────────────────
    pythonunbuffered: str = Field("1", validation_alias="PYTHONUNBUFFERED")
    pythondontwritebytecode: str = Field("1", validation_alias="PYTHONDONTWRITEBYTECODE")

    # pydantic-settings v2 config
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=False,
        extra="ignore",        # <-- IMPORTANT: ignore unknown keys in .env
        env_ignore_empty=True,
    )

    # Convenience: effective Redis DSN if REDIS_URL not given
    @computed_field  # type: ignore[misc]
    @property
    def redis_dsn(self) -> str:
        if self.redis_url:
            return self.redis_url
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"

    # Convenience: pick the best Supabase key available (service role preferred)
    @computed_field  # type: ignore[misc]
    @property
    def supabase_key(self) -> Optional[str]:
        return (
            self.supabase_service_role_key
            or self.supabase_service_key
            or self.supabase_anon_key
            or self.supabase_publishable_key
        )


# Global settings instance
settings = Settings()

