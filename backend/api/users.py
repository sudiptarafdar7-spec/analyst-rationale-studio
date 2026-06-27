"""Users router: self-service profile + admin user management + activity feed."""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user
from core.permissions import ALL, PERMISSIONS, has_perm, require_perm
from core.security import hash_password, verify_password
from db.enums import UserRole
from db.models import User, UserActivity
from db.session import get_db
from schemas.user import (
    ActivityOut,
    AdminUserCreate,
    AdminUserUpdate,
    PasswordChange,
    ProfileUpdate,
    UserOut,
)
from services import activity

router = APIRouter(prefix="/users", tags=["users"])

AVATAR_SUBDIR = "avatars"
MAX_AVATAR_BYTES = 5 * 1024 * 1024
ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_EXT_BY_TYPE = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}


class UserListResponse(BaseModel):
    items: list[UserOut]
    total: int
    page: int
    size: int


def _email_taken(db: Session, email: str, exclude_id: uuid.UUID | None = None) -> bool:
    stmt = select(User).where(User.email == email)
    if exclude_id:
        stmt = stmt.where(User.id != exclude_id)
    return db.scalar(stmt) is not None


# --- static catalog (declared before any /{user_id} route) -----------------
@router.get("/permissions")
def permission_catalog(_admin: User = Depends(require_perm("admin:users"))) -> list[dict]:
    return PERMISSIONS


# --- self-service ----------------------------------------------------------
@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    data = body.model_dump(exclude_unset=True)
    new_email = data.get("email")
    if new_email and new_email != user.email and _email_taken(db, new_email, user.id):
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.get("/me/activities", response_model=list[ActivityOut])
def my_activities(
    limit: int = Query(100, ge=1, le=500),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActivityOut]:
    rows = db.scalars(
        select(UserActivity).where(UserActivity.user_id == user.id)
        .order_by(UserActivity.created_at.desc()).limit(limit)
    ).all()
    return [ActivityOut.model_validate(r) for r in rows]


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UserOut:
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=415, detail="Avatar must be a PNG, JPEG, WEBP or GIF image")
    contents = await file.read()
    if len(contents) > MAX_AVATAR_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be 5 MB or smaller")
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
def change_password(body: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()


# --- admin: activity feed (all users) --------------------------------------
@router.get("/activities", response_model=list[ActivityOut])
def all_activities(
    user_id: uuid.UUID | None = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    _admin: User = Depends(require_perm("admin:users")),
    db: Session = Depends(get_db),
) -> list[ActivityOut]:
    stmt = select(UserActivity).order_by(UserActivity.created_at.desc()).limit(limit)
    if user_id:
        stmt = stmt.where(UserActivity.user_id == user_id)
    return [ActivityOut.model_validate(r) for r in db.scalars(stmt).all()]


# --- admin: user CRUD ------------------------------------------------------
@router.get("", response_model=UserListResponse)
def list_users(
    page: int = Query(1, ge=1), size: int = Query(50, ge=1, le=200),
    _admin: User = Depends(require_perm("admin:users")), db: Session = Depends(get_db),
) -> UserListResponse:
    total = db.scalar(select(func.count()).select_from(User)) or 0
    rows = db.scalars(select(User).order_by(User.created_at.desc()).offset((page - 1) * size).limit(size)).all()
    return UserListResponse(items=[UserOut.model_validate(r) for r in rows], total=total, page=page, size=size)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(body: AdminUserCreate, admin: User = Depends(require_perm("admin:users")), db: Session = Depends(get_db)) -> UserOut:
    if _email_taken(db, body.email):
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    user = User(
        email=body.email, password_hash=hash_password(body.password),
        first_name=body.first_name, last_name=body.last_name, mobile=body.mobile,
        role=body.role, permissions=list(body.permissions or []),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    activity.log(db, admin, "user:create", f"Created {body.role.value} {user.first_name} {user.last_name} ({user.email})",
                 entity_type="user", entity_id=user.id)
    return UserOut.model_validate(user)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: AdminUserUpdate, admin: User = Depends(require_perm("admin:users")), db: Session = Depends(get_db)) -> UserOut:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    data = body.model_dump(exclude_unset=True)

    # Anti-lockout: you can't strip your own user-management rights or deactivate yourself.
    if user.id == admin.id:
        if "is_active" in data and data["is_active"] is False:
            raise HTTPException(status_code=400, detail="You can't deactivate your own account.")
        if "role" in data and data["role"] != UserRole.admin:
            raise HTTPException(status_code=400, detail="You can't change your own role.")
        if "permissions" in data:
            new_perms = data["permissions"] or []
            if ALL not in new_perms and "admin:users" not in new_perms:
                raise HTTPException(status_code=400, detail="You can't remove your own User-management permission.")

    new_email = data.get("email")
    if new_email and new_email != user.email and _email_taken(db, new_email, user.id):
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    password = data.pop("password", None)
    if password:
        user.password_hash = hash_password(password)
    for field, value in data.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    activity.log(db, admin, "user:update", f"Updated user {user.first_name} {user.last_name} ({user.email})",
                 entity_type="user", entity_id=user.id)
    return UserOut.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: uuid.UUID, admin: User = Depends(require_perm("admin:users")), db: Session = Depends(get_db)) -> None:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You can't delete your own account.")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    label = f"{user.first_name} {user.last_name} ({user.email})"
    db.delete(user)
    db.commit()
    activity.log(db, admin, "user:delete", f"Deleted user {label}", entity_type="user", entity_id=user_id)
