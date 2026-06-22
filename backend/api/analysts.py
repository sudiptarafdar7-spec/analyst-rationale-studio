"""Analyst profile management. Admin writes; all authenticated users can read.

`aliases` is a comma-separated list of every name the analyst is called on air;
extraction (Step 4) groups all of these to the one target speaker.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.deps import get_current_user, require_admin
from db.models import Analyst, User
from db.session import get_db
from schemas.analyst import AnalystOut
from utils.files import save_image_upload

router = APIRouter(prefix="/analysts", tags=["analysts"])

AVATAR_SUBDIR = "analyst-avatars"


def _clean_aliases(raw: str | None) -> str | None:
    if not raw:
        return None
    parts = [a.strip() for a in raw.split(",")]
    parts = [a for a in parts if a]
    return ", ".join(parts) or None


@router.get("", response_model=list[AnalystOut])
def list_analysts(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
) -> list[AnalystOut]:
    stmt = select(Analyst).order_by(Analyst.created_at.desc())
    if not include_inactive:
        stmt = stmt.where(Analyst.is_active.is_(True))
    return [AnalystOut.model_validate(a) for a in db.scalars(stmt).all()]


@router.post("", response_model=AnalystOut, status_code=status.HTTP_201_CREATED)
async def create_analyst(
    name: str = Form(..., min_length=1),
    aliases: str | None = Form(None),
    avatar: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AnalystOut:
    avatar_path = await save_image_upload(avatar, AVATAR_SUBDIR) if avatar else None
    analyst = Analyst(
        name=name.strip(),
        aliases=_clean_aliases(aliases),
        avatar_path=avatar_path,
    )
    db.add(analyst)
    db.commit()
    db.refresh(analyst)
    return AnalystOut.model_validate(analyst)


@router.patch("/{analyst_id}", response_model=AnalystOut)
async def update_analyst(
    analyst_id: uuid.UUID,
    name: str | None = Form(None),
    aliases: str | None = Form(None),
    avatar: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> AnalystOut:
    analyst = db.get(Analyst, analyst_id)
    if analyst is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyst not found")

    if name is not None:
        analyst.name = name.strip()
    if aliases is not None:
        analyst.aliases = _clean_aliases(aliases)
    if avatar is not None:
        analyst.avatar_path = await save_image_upload(avatar, AVATAR_SUBDIR)

    db.commit()
    db.refresh(analyst)
    return AnalystOut.model_validate(analyst)


@router.delete("/{analyst_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_analyst(
    analyst_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    analyst = db.get(Analyst, analyst_id)
    if analyst is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyst not found")
    analyst.is_active = False
    db.commit()
