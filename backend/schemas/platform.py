"""Pydantic schemas for media platforms."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict

from db.enums import PlatformType


class PlatformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    platform_type: PlatformType
    channel_name: str
    url: str | None = None
    channel_logo_path: str | None = None
    is_active: bool
    created_at: dt.datetime
