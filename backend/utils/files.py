"""Shared helpers for saving uploaded image files to the upload dir."""
from __future__ import annotations

import os
import uuid

from fastapi import HTTPException, UploadFile, status

from core.config import settings

MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"}
_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}


async def save_image_upload(file: UploadFile, subdir: str, prefix: str = "") -> str:
    """Validate + persist an uploaded image. Returns the public `/uploads/...` path."""
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="File must be a PNG, JPEG, WEBP, GIF or SVG image",
        )
    contents = await file.read()
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 5 MB or smaller")

    dest_dir = os.path.join(settings.UPLOAD_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    ext = _EXT_BY_TYPE.get(file.content_type, ".png")
    name = f"{prefix + '_' if prefix else ''}{uuid.uuid4().hex}{ext}"
    with open(os.path.join(dest_dir, name), "wb") as fh:
        fh.write(contents)
    return f"/uploads/{subdir}/{name}"
