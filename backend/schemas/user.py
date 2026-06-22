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
    avatar_path: str | None = None
    is_active: bool
    last_login_at: dt.datetime | None = None
    created_at: dt.datetime


class ProfileUpdate(BaseModel):
    """Self-service profile edit (PATCH /users/me)."""

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
    password: str = Field(min_length=8, max_length=128)


class AdminUserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None
    first_name: str | None = Field(default=None, min_length=1, max_length=120)
    last_name: str | None = Field(default=None, min_length=1, max_length=120)
    mobile: str | None = Field(default=None, max_length=32)
