"""Admin uploads: Scrip Master CSV, company logo, custom fonts."""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.deps import require_admin
from db.enums import UploadedFileType
from db.models import UploadedFile, User
from db.session import get_db
from schemas.files import MasterUploadOut, UploadedFileOut
from services.master_file import validate_master_csv
from utils.files import ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, save_binary_upload

router = APIRouter(prefix="/admin/files", tags=["admin:files"])

MAX_MASTER_BYTES = 50 * 1024 * 1024  # scrip master can be large
MAX_FONT_BYTES = 5 * 1024 * 1024
FONT_VARIANTS = {"regular", "bold"}


def _variant_of(f: UploadedFile) -> str | None:
    if f.file_type != UploadedFileType.customFont:
        return None
    base = os.path.basename(f.file_path)
    if base.startswith("bold_"):
        return "bold"
    if base.startswith("regular_"):
        return "regular"
    return None


def _to_out(f: UploadedFile) -> UploadedFileOut:
    out = UploadedFileOut.model_validate(f)
    out.variant = _variant_of(f)
    return out


def _deactivate(db: Session, file_type: UploadedFileType, variant: str | None = None) -> None:
    rows = db.scalars(
        select(UploadedFile).where(
            UploadedFile.file_type == file_type, UploadedFile.is_active.is_(True)
        )
    ).all()
    for r in rows:
        if variant is None or _variant_of(r) == variant:
            r.is_active = False


def _store(db: Session, file_type: UploadedFileType, meta: dict, uploader: uuid.UUID) -> UploadedFile:
    row = UploadedFile(
        file_type=file_type,
        file_path=meta["file_path"],
        file_name=meta["file_name"],
        mime_type=meta["mime_type"],
        size_bytes=meta["size_bytes"],
        uploaded_by=uploader,
        is_active=True,
    )
    db.add(row)
    return row


@router.get("", response_model=list[UploadedFileOut])
def list_files(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[UploadedFileOut]:
    stmt = select(UploadedFile).order_by(UploadedFile.uploaded_at.desc())
    if not include_inactive:
        stmt = stmt.where(UploadedFile.is_active.is_(True))
    return [_to_out(f) for f in db.scalars(stmt).all()]


@router.post("/master", response_model=MasterUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_master(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> MasterUploadOut:
    name = (file.filename or "").lower()
    if not name.endswith(".csv"):
        raise HTTPException(status_code=415, detail="Master file must be a .csv")
    meta = await save_binary_upload(file, "master-files", MAX_MASTER_BYTES)
    result = validate_master_csv(meta["contents"])
    if not result["columns_ok"]:
        # Don't persist an invalid master.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Master file is missing required columns: " + ", ".join(result["missing_columns"]),
        )

    _deactivate(db, UploadedFileType.masterFile)
    row = _store(db, UploadedFileType.masterFile, meta, admin.id)
    db.commit()
    db.refresh(row)
    return MasterUploadOut(
        file=_to_out(row),
        columns_ok=True,
        missing_columns=[],
        row_count=result["row_count"],
        equity_count=result["equity_count"],
    )


@router.post("/company-logo", response_model=UploadedFileOut, status_code=status.HTTP_201_CREATED)
async def upload_company_logo(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UploadedFileOut:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Logo must be a PNG, JPEG, WEBP, GIF or SVG image")
    meta = await save_binary_upload(file, "company-logo", MAX_IMAGE_BYTES)
    _deactivate(db, UploadedFileType.companyLogo)
    row = _store(db, UploadedFileType.companyLogo, meta, admin.id)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.post("/font", response_model=UploadedFileOut, status_code=status.HTTP_201_CREATED)
async def upload_font(
    variant: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UploadedFileOut:
    variant = variant.strip().lower()
    if variant not in FONT_VARIANTS:
        raise HTTPException(status_code=422, detail="variant must be 'regular' or 'bold'")
    name = (file.filename or "").lower()
    if not (name.endswith(".ttf") or name.endswith(".otf")):
        raise HTTPException(status_code=415, detail="Font must be a .ttf or .otf file")
    meta = await save_binary_upload(file, "fonts", MAX_FONT_BYTES, prefix=variant)
    _deactivate(db, UploadedFileType.customFont, variant=variant)
    row = _store(db, UploadedFileType.customFont, meta, admin.id)
    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_file(
    file_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> None:
    row = db.get(UploadedFile, file_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    row.is_active = False
    db.commit()
