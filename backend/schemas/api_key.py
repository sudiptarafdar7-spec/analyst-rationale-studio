"""Pydantic schemas for admin API-key management."""
from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field

from db.enums import ApiProvider


class ApiKeyOut(BaseModel):
    """Public view — never includes the plaintext key."""

    provider: ApiProvider
    is_set: bool
    masked: str | None = None
    label: str | None = None
    last_tested_at: dt.datetime | None = None
    last_test_ok: bool | None = None
    updated_at: dt.datetime | None = None


class ApiKeyUpsert(BaseModel):
    key_value: str = Field(min_length=1, max_length=4096)
    label: str | None = Field(default=None, max_length=120)


class ApiKeyReveal(BaseModel):
    password: str = Field(min_length=1)


class ApiKeyRevealOut(BaseModel):
    provider: ApiProvider
    key_value: str


class ApiKeyTestOut(BaseModel):
    ok: bool
    message: str
    tested_at: dt.datetime
