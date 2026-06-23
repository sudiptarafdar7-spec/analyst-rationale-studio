"""Pydantic schemas for Media Presence jobs and their pipeline steps."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict

from db.enums import GateKind, JobStatus, StepStatus


class JobStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    step_no: int
    step_key: str
    status: StepStatus
    log_tail: str | None = None
    error: str | None = None
    started_at: dt.datetime | None = None
    finished_at: dt.datetime | None = None


class AnalystRef(BaseModel):
    id: uuid.UUID
    name: str
    avatar_path: str | None = None


class JobListItem(BaseModel):
    """One Media Presence row."""

    id: uuid.UUID
    platform_id: uuid.UUID | None = None
    platform_name: str | None = None
    platform_type: str | None = None
    platform_logo: str | None = None
    analysts: list[AnalystRef] = []
    title: str | None = None
    youtube_url: str | None = None
    video_date: dt.date | None = None
    video_time: dt.time | None = None
    extract_all_stocks: bool = False
    status: JobStatus
    gate: GateKind
    current_step: int
    audio_url: str | None = None
    pdf_url: str | None = None
    created_at: dt.datetime


class JobDetailOut(JobListItem):
    channel_id: uuid.UUID | None = None
    audio_file_id: uuid.UUID | None = None
    error_message: str | None = None
    output_pdf_path: str | None = None
    steps: list[JobStepOut] = []


class JobUpdateIn(BaseModel):
    platform_id: uuid.UUID | None = None
    analyst_ids: list[uuid.UUID] | None = None
    title: str | None = None
    youtube_url: str | None = None
    video_date: dt.date | None = None
    video_time: dt.time | None = None
    extract_all_stocks: bool | None = None
