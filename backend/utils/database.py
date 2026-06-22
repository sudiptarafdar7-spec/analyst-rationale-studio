"""Database access helpers shared by services and pipeline tools.

`get_api_key` is the canonical read path used by the AI/integration tools — it
returns the *decrypted* provider key (the reference code read plaintext from
`api_keys`; here we decrypt the Fernet ciphertext).
"""
from __future__ import annotations

from sqlalchemy import select

from core.crypto import decrypt
from db.enums import ApiProvider
from db.models import ApiKey
from db.session import SessionLocal


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
