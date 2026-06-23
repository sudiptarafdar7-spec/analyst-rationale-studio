"""Database access helpers shared by services and pipeline tools.

- get_db_cursor(): a psycopg2 cursor context manager (the reference pipeline code
  uses raw cursors). It is sourced from the SQLAlchemy engine's raw connection so
  it reuses the configured DATABASE_URL (including encoded passwords).
- get_api_key(provider): the canonical read path used by the AI/integration tools —
  returns the *decrypted* provider key.
"""
from __future__ import annotations

from contextlib import contextmanager

from sqlalchemy import select

from core.crypto import decrypt
from db.enums import ApiProvider
from db.models import ApiKey
from db.session import SessionLocal, engine


@contextmanager
def get_db_cursor(commit: bool = False):
    """Yield a raw DB cursor. Commits on success when commit=True, else rolls back
    read-only work cleanly. Always returns the connection to the pool."""
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        try:
            yield cur
            if commit:
                conn.commit()
        finally:
            cur.close()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_api_key(provider: str | ApiProvider) -> str | None:
    """Return the decrypted API key for a provider, or None if unset/inactive."""
    value = provider.value if isinstance(provider, ApiProvider) else provider
    with SessionLocal() as db:
        row = db.scalar(
            select(ApiKey).where(ApiKey.provider == value, ApiKey.is_active.is_(True))
        )
        if row is None:
            return None
        return decrypt(row.key_value)
