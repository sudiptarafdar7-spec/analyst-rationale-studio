"""Standalone pipeline tools exposed directly to users (Generate Chart, master search)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from core.deps import get_current_user
from db.models import User
from schemas.integrations import GenerateChartIn, GenerateChartOut, InstrumentOut, MasterHit
from services.dhan import render_chart_range

router = APIRouter(prefix="/tools", tags=["tools"])


@router.post("/generate-chart", response_model=GenerateChartOut)
def generate_chart(body: GenerateChartIn, _user: User = Depends(get_current_user)) -> GenerateChartOut:
    """Render a premium candlestick chart (MA + RSI + CMP) for any instrument over
    a date range, at Daily / Weekly / Monthly resolution. Served from /uploads."""
    _save_path, public_url, cmp = render_chart_range(
        security_id=body.security_id,
        exchange=body.exchange,
        instrument=body.instrument,
        chart_type=body.chart_type,
        from_date=body.from_date,
        to_date=body.to_date,
        short_name=body.short_name or "",
    )
    return GenerateChartOut(chart_url=public_url, cmp=cmp)


@router.get("/master-instruments", response_model=list[InstrumentOut])
def master_instruments(_user: User = Depends(get_current_user)) -> list[InstrumentOut]:
    """Instrument types available in the active scrip master (for the chart tabs)."""
    from services.master_search import list_instruments

    return [InstrumentOut(**i) for i in list_instruments()]


@router.get("/master-search", response_model=list[MasterHit])
def master_search(
    q: str = Query(..., min_length=1, description="Symbol or name fragment"),
    instrument: str | None = Query(None, description="Filter by instrument type"),
    limit: int = Query(20, ge=1, le=50),
    _user: User = Depends(get_current_user),
) -> list[MasterHit]:
    """Search the active scrip master for stocks matching q within an instrument."""
    from services.master_search import search_master

    return [MasterHit(**h) for h in search_master(q, instrument, limit)]
