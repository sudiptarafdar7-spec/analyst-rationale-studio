"""Pydantic schemas for admin required-file uploads."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict

from db.enums import UploadedFileType


class UploadedFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_type: UploadedFileType
    file_name: str
    file_path: str
    mime_type: str | None = None
    size_bytes: int | None = None
    is_active: bool
    uploaded_at: dt.datetime
    variant: str | None = None  # for fonts: 'regular' | 'bold'


class MasterUploadOut(BaseModel):
    file: UploadedFileOut
    columns_ok: bool
    missing_columns: list[str]
    row_count: int
    equity_count: int
