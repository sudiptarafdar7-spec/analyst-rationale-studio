"""Users router: self-service profile + admin user management."""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user, require_admin
from core.security import hash_password, verify_password
from db.models import User
from db.session import get_db
from schemas.user import (
    AdminUserCreate,
    AdminUserUpdate,
    PasswordChange,
    ProfileUpdate,
    UserOut,
)

router = APIRouter(prefix="/users", tags=["users"])

AVATAR_SUBDIR = "avatars"
MAX_AVATAR_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class UserListResponse(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    size: int


# --- self-service ----------------------------------------------------------
@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Avatar must be a PNG, JPEG, WEBP or GIF image",
        )
    contents = await file.read()
    if len(contents) > MAX_AVATAR_BYTES:
        raise HTTPException(
            status_code=413,  # Content Too Large
            detail="Avatar must be 5 MB or smaller",
        )

    dest_dir = os.path.join(settings.UPLOAD_DIR, AVATAR_SUBDIR)
    os.makedirs(dest_dir, exist_ok=True)
    ext = _EXT_BY_TYPE.get(file.content_type, ".png")
    filename = f"{user.id}_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(dest_dir, filename), "wb") as fh:
        fh.write(contents)

    user.avatar_path = f"/uploads/{AVATAR_SUBDIR}/{filename}"
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    body: PasswordChange,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()


# --- admin user management -------------------------------------------------
@router.get("", response_model=UserListResponse)
def list_users(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserListResponse:
    total = db.scalar(select(func.count()).select_from(User)) or 0
    rows = db.scalars(
        select(User).order_by(User.created_at.desc()).offset((page - 1) * size).limit(size)
    ).all()
    return UserListResponse(
        items=[UserOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        size=size,
    )


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    body: AdminUserCreate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserOut:
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        mobile=body.mobile,
        role=body.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    body: AdminUserUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    data = body.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)
