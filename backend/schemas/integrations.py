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
    instrument: str = "EQUITY"
    chart_type: str = "Daily"  # Daily | Weekly | Monthly
    from_date: str = Field(..., description="Range start (YYYY-MM-DD)")
    to_date: str = Field(..., description="Range end (YYYY-MM-DD)")
    short_name: str | None = None


class GenerateChartOut(BaseModel):
    chart_url: str
    cmp: float | None = None


class MasterHit(BaseModel):
    symbol: str
    short_name: str
    listed_name: str
    security_id: str
    exchange: str
    instrument: str


class InstrumentOut(BaseModel):
    value: str
    label: str
    count: int
