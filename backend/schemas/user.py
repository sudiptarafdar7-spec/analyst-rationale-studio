"""Pydantic v2 schemas for users / profile."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from db.enums import UserRole


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    first_name: str
    last_name: str
    mobile: str | None = None
    role: UserRole
    permissions: list[str] = []
    avatar_path: str | None = None
    is_active: bool
    last_login_at: dt.datetime | None = None
    created_at: dt.datetime


class ProfileUpdate(BaseModel):
    """Self-service profile edit (PATCH /users/me)."""

    email: EmailStr | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    mobile: str | None = Field(default=None, max_length=32)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class AdminUserCreate(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    mobile: str | None = Field(default=None, max_length=32)
    role: UserRole = UserRole.employee
    permissions: list[str] = []
    password: str = Field(min_length=8, max_length=128)


class AdminUserUpdate(BaseModel):
    email: EmailStr | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    permissions: list[str] | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    mobile: str | None = Field(default=None, max_length=32)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID | None = None
    actor_name: str | None = None
    action: str
    summary: str
    entity_type: str | None = None
    entity_id: str | None = None
    created_at: dt.datetime
