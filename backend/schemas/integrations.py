"""Pydantic schemas for the integration endpoints (YouTube + standalone chart)."""
from __future__ import annotations

from pydantic import BaseModel, Field


class YoutubeMetadataOut(BaseModel):
    video_id: str
    channel: str
    title: str
    upload_date: str | None = None  # YYYY-MM-DD (IST)
    upload_time: str | None = None  # HH:MM:SS (IST)


class GenerateChartIn(BaseModel):
    security_id: str = Field(..., min_length=1, description="Dhan security id for the scrip")
    exchange: str = "NSE"
    date: str = Field(..., description="Call date (any common/Excel format)")
    time: str = "15:30:00"
    chart_type: str = "Daily"
    short_name: str | None = None


class GenerateChartOut(BaseModel):
    chart_url: str
    cmp: float | None = None
