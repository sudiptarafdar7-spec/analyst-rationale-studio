"""Password hashing and JWT / refresh-token helpers.

Access tokens are short-lived JWTs (Bearer). Refresh tokens are opaque random
strings; only their SHA-256 hash is stored (refresh_tokens table) and the raw
value lives in an httpOnly cookie.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

REFRESH_COOKIE_NAME = "refresh_token"


# --- passwords -------------------------------------------------------------
def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


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
