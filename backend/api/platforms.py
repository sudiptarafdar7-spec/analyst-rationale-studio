"""Media platform management. Admin writes; all authenticated users can read."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from core.deps import get_current_user, require_admin
from db.enums import PlatformType
from db.models import Job, Platform, User
from db.session import get_db
from schemas.platform import PlatformOut
from utils.files import save_image_upload

router = APIRouter(prefix="/platforms", tags=["platforms"])

LOGO_SUBDIR = "platform-logos"


@router.get("", response_model=list[PlatformOut])
def list_platforms(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[PlatformOut]:
    stmt = select(Platform).order_by(Platform.created_at.desc())
    if not include_inactive:
        stmt = stmt.where(Platform.is_active.is_(True))
    return [PlatformOut.model_validate(p) for p in db.scalars(stmt).all()]


@router.post("", response_model=PlatformOut, status_code=status.HTTP_201_CREATED)
async def create_platform(
    platform_type: PlatformType = Form(...),
    channel_name: str = Form(..., min_length=1),
    url: str | None = Form(None),
    logo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> PlatformOut:
    logo_path = await save_image_upload(logo, LOGO_SUBDIR) if logo else None
    platform = Platform(
        platform_type=platform_type,
        channel_name=channel_name.strip(),
        url=(url.strip() if url else None),
        channel_logo_path=logo_path,
        created_by=admin.id,
    )
    db.add(platform)
    db.commit()
    db.refresh(platform)
    return PlatformOut.model_validate(platform)


@router.patch("/{platform_id}", response_model=PlatformOut)
async def update_platform(
    platform_id: uuid.UUID,
    platform_type: PlatformType | None = Form(None),
    channel_name: str | None = Form(None),
    url: str | None = Form(None),
    logo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> PlatformOut:
    platform = db.get(Platform, platform_id)
    if platform is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform not found")

    if platform_type is not None:
        platform.platform_type = platform_type
    if channel_name is not None:
        platform.channel_name = channel_name.strip()
    if url is not None:
        platform.url = url.strip() or None
    if logo is not None:
        platform.channel_logo_path = await save_image_upload(logo, LOGO_SUBDIR)

    db.commit()
    db.refresh(platform)
    return PlatformOut.model_validate(platform)


@router.delete("/{platform_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_platform(
    platform_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    platform = db.get(Platform, platform_id)
    if platform is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform not found")

    # Block deletion if any job references this platform; otherwise soft delete.
    in_use = db.scalar(select(func.count()).select_from(Job).where(Job.platform_id == platform_id)) or 0
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This platform is used by {in_use} job(s) and cannot be deleted.",
        )
    platform.is_active = False
    db.commit()
