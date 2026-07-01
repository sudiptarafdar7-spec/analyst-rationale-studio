"""Employee-facing API-key access — granular per-provider.

A user granted `apikey:<provider>:edit` can REPLACE or REMOVE that one provider's
key (and test it), but can NOT reveal or view it, and does NOT need the full
admin:api_keys area. Backend enforces the per-provider permission on every call.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.crypto import EncryptionError, decrypt, encrypt
from core.deps import get_current_user
from core.permissions import has_perm
from core.rate_limit import rate_limit_test
from db.enums import ApiProvider
from db.models import ApiKey, User
from db.session import get_db
from schemas.api_key import ApiKeyOut, ApiKeyTestOut, ApiKeyUpsert
from services import activity
from services.provider_test import test_provider

router = APIRouter(prefix="/apikeys", tags=["apikeys"])


def _perm(provider: ApiProvider) -> str:
    return f"apikey:{provider.value}:edit"


def _require_provider(provider: ApiProvider, user: User) -> None:
    if not has_perm(user, _perm(provider)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="You don't have permission to update this API key.")


def _status(provider: ApiProvider, row: ApiKey | None) -> ApiKeyOut:
    # NOTE: never includes the key value or a masked preview.
    if row is None:
        return ApiKeyOut(provider=provider, is_set=False)
    return ApiKeyOut(
        provider=provider, is_set=True, label=row.label,
        last_tested_at=row.last_tested_at, last_test_ok=row.last_test_ok,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[ApiKeyOut])
def my_editable_keys(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ApiKeyOut]:
    """Only the providers this user may edit, with set/label/test status (no value)."""
    editable = [p for p in ApiProvider if has_perm(user, _perm(p))]
    rows = {r.provider: r for r in db.scalars(select(ApiKey)).all()}
    return [_status(p, rows.get(p)) for p in editable]


@router.put("/{provider}", response_model=ApiKeyOut)
def replace_key(
    provider: ApiProvider,
    body: ApiKeyUpsert,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ApiKeyOut:
    _require_provider(provider, user)
    if not body.key_value.strip():
        raise HTTPException(status_code=422, detail="Key value is required.")
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    ciphertext = encrypt(body.key_value.strip())
    if row is None:
        row = ApiKey(provider=provider, key_value=ciphertext, label=body.label, is_active=True)
        db.add(row)
    else:
        row.key_value = ciphertext
        row.label = body.label
        row.is_active = True
        row.last_tested_at = None
        row.last_test_ok = None
    db.commit()
    db.refresh(row)
    activity.log(db, user, _perm(provider), f"Replaced the {provider.value} API key", entity_type="api_key", entity_id=None)
    return _status(provider, row)


@router.delete("/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def remove_key(
    provider: ApiProvider,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    _require_provider(provider, user)
    row = db.scalar(select(ApiKey).where(ApiKey.provider == provider))
    if row is not None:
        db.delete(row)
        db.commit()
        activity.log(db, user, _perm(provider), f"Removed the {provider.value} API key", entity_type="api_key", entity_id=None)


@router.post("/{provider}/test", response_model=ApiKeyTestOut)
def test_key(
    provider: ApiProvider,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _rl: None = Depends(rate_limit_test),
) -> ApiKeyTestOut:
    _require_provider(provider, user)
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
