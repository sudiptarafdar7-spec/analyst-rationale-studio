"""Stock Analysis — Watchlist (admin).

Lists every standardised call lifted from saved rationales, with live tracking
(peak-since-call CMP), per-target achievement, P/L and status. Supports
filtered/all/single CMP refresh and removal.
"""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.deps import require_admin
from db.models import User, WatchlistCall
from db.session import get_db
from schemas.watchlist import (
    InstrumentCount,
    RefreshCmpIn,
    RefreshCmpOut,
    WatchlistOut,
    WatchlistRow,
)
from services import watchlist as wl
from services.master_search import INSTRUMENT_LABELS
from services.pipeline import job_folder

router = APIRouter(prefix="/watchlist", tags=["watchlist"])


def _serialize(call: WatchlistCall) -> WatchlistRow:
    view = wl.compute_view(call)
    chart_url = f"/api/watchlist/{call.id}/chart" if call.chart_path else None
    return WatchlistRow(
        id=call.id,
        job_id=call.job_id,
        platform_name=call.platform_name,
        platform_type=call.platform_type,
        channel_logo_path=call.channel_logo_path,
        analyst_names=call.analyst_names,
        call_date=call.call_date,
        call_time=call.call_time,
        stock_symbol=call.stock_symbol,
        short_name=call.short_name,
        listed_name=call.listed_name,
        security_id=call.security_id,
        exchange=call.exchange,
        instrument=call.instrument,
        chart_url=chart_url,
        call_type=call.call_type.value if hasattr(call.call_type, "value") else str(call.call_type),
        call_cmp=call.call_cmp,
        targets=list(call.targets or []),
        stoploss=call.stoploss,
        downfall_target=call.downfall_target,
        holding_period=call.holding_period,
        holding_period_days=call.holding_period_days,
        analysis_text=call.analysis_text,
        current_cmp=call.current_cmp,
        peak_high=call.peak_high,
        trough_low=call.trough_low,
        cmp_fetched_at=call.cmp_fetched_at,
        **view,
    )


@router.get("", response_model=WatchlistOut)
def list_watchlist(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    instrument: str | None = Query(None),
    call_type: str | None = Query(None),
    status: str | None = Query(None, description="achieved | awaited"),
    job_id: uuid.UUID | None = Query(None, description="only calls from this rationale job"),
    q: str | None = Query(None),
) -> WatchlistOut:
    stmt = select(WatchlistCall).order_by(WatchlistCall.call_date.desc().nullslast(), WatchlistCall.created_at.desc())
    if date_from:
        stmt = stmt.where(WatchlistCall.call_date >= date_from)
    if date_to:
        stmt = stmt.where(WatchlistCall.call_date <= date_to)
    if instrument:
        stmt = stmt.where(WatchlistCall.instrument == instrument)
    if call_type:
        stmt = stmt.where(WatchlistCall.call_type == call_type)
    if job_id:
        stmt = stmt.where(WatchlistCall.job_id == job_id)

    calls = db.scalars(stmt).all()

    # Instrument facet is GLOBAL (every call in the watchlist) so the filter
    # chips stay stable no matter what is currently selected.
    inst_counts: dict[str, int] = {}
    for inst in db.scalars(select(WatchlistCall.instrument)).all():
        key = (inst or "EQUITY").upper()
        inst_counts[key] = inst_counts.get(key, 0) + 1

    rows = [_serialize(c) for c in calls]
    if status in ("achieved", "awaited"):
        rows = [r for r in rows if r.status == status]
    if q:
        ql = q.strip().lower()
        rows = [
            r for r in rows
            if ql in (r.stock_symbol or "").lower()
            or ql in (r.short_name or "").lower()
            or ql in (r.listed_name or "").lower()
            or ql in (r.platform_name or "").lower()
        ]

    instruments = [
        InstrumentCount(value=v, label=INSTRUMENT_LABELS.get(v, v.title()), count=n)
        for v, n in sorted(inst_counts.items(), key=lambda kv: -kv[1])
    ]
    return WatchlistOut(items=rows, total=len(rows), instruments=instruments)


@router.post("/refresh-cmp", response_model=RefreshCmpOut)
def refresh_cmp(
    body: RefreshCmpIn,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> RefreshCmpOut:
    stmt = select(WatchlistCall)
    if body.ids:
        stmt = stmt.where(WatchlistCall.id.in_(body.ids))
    calls = db.scalars(stmt).all()
    summary = wl.refresh_many(db, calls)
    return RefreshCmpOut(**summary)


@router.post("/{call_id}/refresh-cmp", response_model=WatchlistRow)
def refresh_one(
    call_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> WatchlistRow:
    call = db.get(WatchlistCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    try:
        wl.refresh_call_cmp(db, call)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"CMP fetch failed: {exc}")
    db.refresh(call)
    return _serialize(call)


@router.delete("/{call_id}")
def remove_call(
    call_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> dict:
    call = db.get(WatchlistCall, call_id)
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    db.delete(call)
    db.commit()
    return {"removed": str(call_id)}


@router.get("/{call_id}/chart")
def get_chart(
    call_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> FileResponse:
    call = db.get(WatchlistCall, call_id)
    if not call or not call.chart_path or not call.job_id:
        raise HTTPException(status_code=404, detail="Chart not available")
    path = os.path.join(job_folder(call.job_id), call.chart_path)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Chart file missing")
    return FileResponse(path, media_type="image/png", filename=os.path.basename(path))
