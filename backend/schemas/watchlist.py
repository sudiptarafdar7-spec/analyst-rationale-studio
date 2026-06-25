"""Pydantic schemas for the Stock Analysis watchlist."""
from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel


class TargetStatus(BaseModel):
    value: float
    achieved: bool


class WatchlistRow(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID | None = None

    # source snapshot
    platform_name: str | None = None
    platform_type: str | None = None
    channel_logo_path: str | None = None
    analyst_names: str | None = None
    call_date: dt.date | None = None
    call_time: dt.time | None = None

    # stock identity
    stock_symbol: str | None = None
    short_name: str | None = None
    listed_name: str | None = None
    security_id: str | None = None
    exchange: str | None = None
    instrument: str | None = None
    chart_url: str | None = None

    # recommendation
    call_type: str
    call_cmp: float | None = None
    targets: list[float] = []
    stoploss: float | None = None
    downfall_target: float | None = None
    holding_period: str | None = None
    holding_period_days: int | None = None
    analysis_text: str | None = None

    # tracking
    current_cmp: float | None = None
    peak_high: float | None = None
    trough_low: float | None = None
    cmp_fetched_at: dt.datetime | None = None

    # derived
    targets_status: list[TargetStatus] = []
    achieved_count: int = 0
    total_targets: int = 0
    downfall_hit: bool = False
    status: str = "awaited"
    pnl_abs: float | None = None
    pnl_pct: float | None = None
    days_since: int | None = None
    holding_elapsed: bool | None = None
    highlight: str = "neutral"


class InstrumentCount(BaseModel):
    value: str
    label: str
    count: int


class WatchlistOut(BaseModel):
    items: list[WatchlistRow]
    total: int
    instruments: list[InstrumentCount] = []


class RefreshCmpIn(BaseModel):
    ids: list[uuid.UUID] | None = None  # None = every call


class RefreshCmpOut(BaseModel):
    updated: int
    failed: int
    total: int
