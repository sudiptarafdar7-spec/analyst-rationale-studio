"""Password hashing and JWT / refresh-token helpers.

Password hashing uses the `bcrypt` library directly (passlib is unmaintained and
breaks against bcrypt >= 4.1 on newer Pythons). bcrypt only considers the first
72 bytes of a secret, so we truncate to that boundary explicitly.

Access tokens are short-lived JWTs (Bearer). Refresh tokens are opaque random
strings; only their SHA-256 hash is stored and the raw value lives in an
httpOnly cookie.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

import bcrypt
from jose import JWTError, jwt

from core.config import settings

REFRESH_COOKIE_NAME = "refresh_token"
_BCRYPT_MAX_BYTES = 72


# --- passwords -------------------------------------------------------------
def _to_bcrypt_bytes(plain: str) -> bytes:
    # bcrypt silently used to truncate at 72 bytes; modern bcrypt raises, so we
    # truncate on a UTF-8 byte boundary ourselves.
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_to_bcrypt_bytes(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bcrypt_bytes(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- access token (JWT) ----------------------------------------------------
def create_access_token(user_id: uuid.UUID, role: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != "access":
        return None
    return payload


# --- refresh token (opaque + hashed at rest) -------------------------------
def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def refresh_expiry() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=settings.REFRESH_TOKEN_DAYS)
