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


def save_image_from_url(url: str, subdir: str, prefix: str = "") -> str:
    """Download a remote image (e.g. a YouTube channel avatar) into the upload
    dir and return its public `/uploads/...` path."""
    import httpx

    try:
        r = httpx.get(url, timeout=12.0, follow_redirects=True)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not download image: {exc}") from exc
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Image download returned HTTP {r.status_code}")
    content = r.content
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Downloaded image exceeds 5 MB")

    ctype = r.headers.get("content-type", "image/jpeg").split(";")[0].strip()
    ext = _EXT_BY_TYPE.get(ctype, ".jpg")
    dest_dir = os.path.join(settings.UPLOAD_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    name = f"{prefix + '_' if prefix else ''}{uuid.uuid4().hex}{ext}"
    with open(os.path.join(dest_dir, name), "wb") as fh:
        fh.write(content)
    return f"/uploads/{subdir}/{name}"


async def save_binary_upload(file: UploadFile, subdir: str, max_bytes: int, prefix: str = "") -> dict:
    """Persist any uploaded file (CSV, font, ...). Returns metadata dict.

    Returns: {file_path, file_name, size_bytes, mime_type, contents}
    (contents included so callers can validate/parse without re-reading).
    """
    contents = await file.read()
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {max_bytes // (1024 * 1024)} MB limit",
        )
    orig = os.path.basename(file.filename or "upload")
    safe = "".join(ch for ch in orig if ch.isalnum() or ch in "._- ").strip() or "upload"
    dest_dir = os.path.join(settings.UPLOAD_DIR, subdir)
    os.makedirs(dest_dir, exist_ok=True)
    stored = f"{prefix + '_' if prefix else ''}{uuid.uuid4().hex}_{safe}"
    with open(os.path.join(dest_dir, stored), "wb") as fh:
        fh.write(contents)
    return {
        "file_path": f"/uploads/{subdir}/{stored}",
        "file_name": orig,
        "size_bytes": len(contents),
        "mime_type": file.content_type,
        "contents": contents,
    }
