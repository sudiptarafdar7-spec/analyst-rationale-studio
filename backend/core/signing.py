"""HMAC-signed, expiring URLs for file downloads (docs/02 §7).

A signed URL authorizes access to one resource path until `exp` without a bearer
token, so PDFs/artifacts can be embedded in <iframe>/<img> or downloaded directly.
Signatures are HMAC-SHA256 over "path|exp" keyed by JWT_SECRET.
"""
from __future__ import annotations

import hashlib
import hmac
import time

from core.config import settings

DEFAULT_TTL_SECONDS = 600  # 10 minutes


def _mac(path: str, exp: int) -> str:
    msg = f"{path}|{exp}".encode()
    return hmac.new(settings.JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def sign_path(path: str, ttl: int = DEFAULT_TTL_SECONDS) -> tuple[str, int]:
    """Return (signature, exp_unix) for a resource path."""
    exp = int(time.time()) + int(ttl)
    return _mac(path, exp), exp


def verify_path(path: str, exp: int, sig: str) -> bool:
    """True if the signature is valid for this path and not expired."""
    try:
        exp = int(exp)
    except (TypeError, ValueError):
        return False
    if exp < int(time.time()):
        return False
    if not sig:
        return False
    return hmac.compare_digest(_mac(path, exp), sig)
