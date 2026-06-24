"""Standalone pipeline tools exposed directly to users (e.g. Generate Chart)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from core.deps import get_current_user
from db.models import User
from schemas.integrations import GenerateChartIn, GenerateChartOut
from services.dhan import render_chart_png

router = APIRouter(prefix="/tools", tags=["tools"])


@router.post("/generate-chart", response_model=GenerateChartOut)
def generate_chart(
    body: GenerateChartIn,
    _user: User = Depends(get_current_user),
) -> GenerateChartOut:
    """Render a premium stock chart PNG for one scrip and return its public URL.

    Reuses the bulk pipeline's Dhan fetch + mplfinance engine (CMP line,
    MA20/50/100/200, RSI-14). The PNG is served from the /uploads static mount.
    """
    _save_path, public_url, cmp = render_chart_png(
        security_id=body.security_id,
        exchange=body.exchange,
        date_str=body.date,
        time_str=body.time,
        chart_type=body.chart_type,
        short_name=body.short_name or "",
    )
    return GenerateChartOut(chart_url=public_url, cmp=cmp)


@router.get("/master-search")
def master_search(
    q: str = Query(..., min_length=1, description="Symbol or name fragment"),
    limit: int = Query(20, ge=1, le=50),
    _user: User = Depends(get_current_user),
) -> dict:
    """Search the active scrip master for stocks matching q (mapping gate autofill)."""
    from services.master_search import search_master

    return {"results": search_master(q, limit)}
