"""Notification DTOs."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID | None = None
    kind: str
    title: str
    body: str | None = None
    read: bool
    created_at: dt.datetime


class UnreadCount(BaseModel):
    count: int
