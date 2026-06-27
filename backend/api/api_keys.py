"""Admin API-key management (encrypted at rest)."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.crypto import EncryptionError, decrypt, encrypt
from core.rate_limit import rate_limit_test
from core.deps import require_admin
from core.permissions import require_perm
from core.security import verify_password
from db.enums import ApiProvider
from db.models import ApiKey, User
from db.session import get_db
from schemas.api_key import (
    ApiKeyOut,
    ApiKeyRevealOut,
    ApiKeyReveal,
    ApiKeyTestOut,
    ApiKeyUpsert,
)
from services.provider_test import test_provider

router = APIRouter(prefix="/admin/api-keys", tags=["admin:api-keys"])


def _mask(plaintext: str) -> str:
    if len(plaintext) <= 8:
        return "••••"
    return f"{plaintext[:3]}••••{plaintext[-4:]}"


def _to_out(provider: ApiProvider, row: ApiKey | None) -> ApiKeyOut:
    if row is None:
        return ApiKeyOut(provider=provider, is_set=False)
    try:
        masked = _mask(decrypt(row.key_value))
    except EncryptionError:
        masked = "(unreadable)"
    return ApiKeyOut(
        provider=provider,
        is_set=True,
        masked=masked,
        label=row.label,
        last_tested_at=row.last_tested_at,
        last_test_ok=row.last_test_ok,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[ApiKeyOut])
def list_keys(db: Session = Depends(get_db), _: User = Depends(require_perm("admin:api_keys"))) -> list[ApiKeyOut]:
    rows = {r.provider: r for r in db.scalars(select(ApiKey)).all()}
    return [_to_out(p, rows.get(p)) for p in ApiProvider]


@router.put("/{provider}", response_model=ApiKeyOut)
def upsert_key(
    provider: ApiProvider,
    body: ApiKeyUpsert,
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("admin:api_keys")),
) -> ApiKeyOut:
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    ciphertext = encrypt(body.key_value.strip())
    if row is None:
        row = ApiKey(provider=provider, key_value=ciphertext, label=body.label, is_active=True)
        db.add(row)
    else:
        row.key_value = ciphertext
        row.label = body.label
        row.is_active = True
        # New secret invalidates any prior test result.
        row.last_tested_at = None
        row.last_test_ok = None
    db.commit()
    db.refresh(row)
    return _to_out(provider, row)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def delete_key(
    provider: ApiProvider,
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("admin:api_keys")),
) -> None:
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    if row is not None:
        db.delete(row)
        db.commit()


@router.post("/{provider}/test", response_model=ApiKeyTestOut)
def test_key(
    provider: ApiProvider,
    db: Session = Depends(get_db),
    _: User = Depends(require_perm("admin:api_keys")),
    _rl: None = Depends(rate_limit_test),
) -> ApiKeyTestOut:
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No key set for this provider")
    try:
        plaintext = decrypt(row.key_value)
    except EncryptionError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stored key could not be decrypted")

    ok, message = test_provider(provider, plaintext)
    now = dt.datetime.now(dt.timezone.utc)
    row.last_tested_at = now
    row.last_test_ok = ok
    db.commit()
    return ApiKeyTestOut(ok=ok, message=message, tested_at=now)


@router.post("/{provider}/reveal", response_model=ApiKeyRevealOut)
def reveal_key(
    provider: ApiProvider,
    body: ApiKeyReveal,
    db: Session = Depends(get_db),
    admin: User = Depends(require_perm("admin:api_keys")),
) -> ApiKeyRevealOut:
    # Re-authenticate the admin before returning plaintext.
    if not verify_password(body.password, admin.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect")
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No key set for this provider")
    try:
        plaintext = decrypt(row.key_value)
    except EncryptionError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Stored key could not be decrypted")
    return ApiKeyRevealOut(provider=provider, key_value=plaintext)
