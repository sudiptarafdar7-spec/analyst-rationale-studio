"""Application configuration.

Loads settings from environment variables (and a local .env in dev) via
pydantic-settings. Only infrastructure secrets live here — provider API keys
are managed in-app (the `api_keys` table), never in env.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- Core infra (the only secrets that belong in env) ---
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/ars"
    JWT_SECRET: str = "change-me-in-env"
    APP_ENCRYPTION_KEY: str = ""  # Fernet key; required once api-key encryption lands

    # --- Auth lifetimes ---
    ACCESS_TOKEN_MINUTES: int = 30
    REFRESH_TOKEN_DAYS: int = 14

    # --- App wiring ---
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    JOB_FILES_DIR: str = "job_files"

    # --- Optional (worker) ---
    REDIS_URL: str = "redis://localhost:6379/0"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.FRONTEND_ORIGIN.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
