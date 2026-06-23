"""Global model resolution (the `__global__` fallback)."""
from __future__ import annotations

from db.models import ModelSettings
from db.session import SessionLocal

DEFAULT_GLOBAL_MODEL = "gpt-4o"


def get_model() -> str:
    """Return the configured global fallback model name."""
    with SessionLocal() as db:
        row = db.get(ModelSettings, 1)
        return row.global_model if row and row.global_model else DEFAULT_GLOBAL_MODEL
