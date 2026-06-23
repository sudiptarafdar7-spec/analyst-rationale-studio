"""Global / mini model resolution."""
from __future__ import annotations

from db.models import ModelSettings
from db.session import SessionLocal

DEFAULT_GLOBAL_MODEL = "gpt-4o"


def _settings():
    with SessionLocal() as db:
        return db.get(ModelSettings, 1)


def get_model() -> str:
    row = _settings()
    return row.global_model if row and row.global_model else DEFAULT_GLOBAL_MODEL


def get_mini_model() -> str:
    """Cheaper model for light tasks (translation). Falls back to global."""
    row = _settings()
    if row and row.advanced_model:
        return row.advanced_model
    return get_model()
