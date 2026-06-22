"""Pydantic schemas for analysts."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict


class AnalystOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    aliases: str | None = None  # comma-separated short names / on-air aliases
    avatar_path: str | None = None
    is_active: bool
    created_at: dt.datetime
