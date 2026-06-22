"""Authentication router: login, refresh, logout, me."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user
from core.rate_limit import rate_limit_login
from core.security import (
    REFRESH_COOKIE_NAME,
    create_access_token,
    generate_refresh_token,
    hash_refresh_token,
    refresh_expiry,
    verify_password,
)
from db.models import RefreshToken, User
from db.session import get_db
from schemas.auth import AccessTokenResponse, LoginRequest, TokenResponse
from schemas.user import UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_PATH = "/api/auth"


def _set_refresh_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        samesite="lax",
        secure=False,  # set True behind HTTPS in production
        max_age=settings.REFRESH_TOKEN_DAYS * 24 * 3600,
        path=REFRESH_COOKIE_PATH,
    )


def _issue_refresh(db: Session, user: User, response: Response) -> None:
    raw = generate_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_refresh_token(raw),
            expires_at=refresh_expiry(),
        )
    )
    _set_refresh_cookie(response, raw)


@router.post("/login", response_model=TokenResponse)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    _: None = Depends(rate_limit_login),
) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    user.last_login_at = dt.datetime.now(dt.timezone.utc)
    _issue_refresh(db, user, response)
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.id, user.role.value),
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=AccessTokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AccessTokenResponse:
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

    token_hash = hash_refresh_token(raw)
    now = dt.datetime.now(dt.timezone.utc)
    rt = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked.is_(False),
        )
    )
    if rt is None or rt.expires_at <= now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user = db.get(User, rt.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Rotate: revoke the used token, issue a fresh one.
    rt.revoked = True
    _issue_refresh(db, user, response)
    db.commit()

    return AccessTokenResponse(access_token=create_access_token(user.id, user.role.value))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> Response:
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if raw:
        rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(raw)))
        if rt is not None:
            rt.revoked = True
            db.commit()
    response.delete_cookie(REFRESH_COOKIE_NAME, path=REFRESH_COOKIE_PATH)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
