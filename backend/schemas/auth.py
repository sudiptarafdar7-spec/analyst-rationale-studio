"""Pydantic v2 schemas for authentication."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr

from schemas.user import UserOut


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
