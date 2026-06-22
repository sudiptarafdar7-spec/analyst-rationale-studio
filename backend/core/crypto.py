"""Symmetric encryption for secrets at rest (provider API keys).

Uses Fernet with the key from `APP_ENCRYPTION_KEY`. Generate a key with:
    python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings


class EncryptionError(RuntimeError):
    pass


@lru_cache
def _fernet() -> Fernet:
    key = settings.APP_ENCRYPTION_KEY
    if not key:
        raise EncryptionError(
            "APP_ENCRYPTION_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())\"`"
        )
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise EncryptionError("APP_ENCRYPTION_KEY is not a valid Fernet key") from exc


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise EncryptionError("Could not decrypt value (wrong key or corrupt data)") from exc
