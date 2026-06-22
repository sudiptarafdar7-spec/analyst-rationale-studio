"""Pydantic schemas for the PDF template (branding for Step 10)."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict, Field


class PdfTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    company_name: str
    registration_details: str | None = None
    disclaimer_text: str | None = None
    disclosure_text: str | None = None
    company_data: str | None = None
    created_at: dt.datetime
    updated_at: dt.datetime


class PdfTemplateUpsert(BaseModel):
    company_name: str = Field(min_length=1, max_length=300)
    registration_details: str | None = None  # rich HTML
    disclaimer_text: str | None = None
    disclosure_text: str | None = None
    company_data: str | None = None
