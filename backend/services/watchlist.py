"""Watchlist service — build calls from a saved rationale and track them.

Flow:
  * build_from_job(db, job): read the final stocks_with_charts.csv, run the
    strict step-11 extraction per stock, and upsert one WatchlistCall per stock.
  * refresh_call_cmp / refresh_many: pull daily OHLC from the call date to today
    (peak high / trough low + last close) so target achievement is accurate.
  * compute_view(call): pure derivation of per-target achievement, status,
    P/L and the row highlight — shared by the API serializer and unit tests.
"""
from __future__ import annotations

import datetime as dt
import os
import time

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from db.models import Analyst, Job, JobAnalyst, Platform, WatchlistCall
from db.enums import CallType
from services import dhan
from services.pipeline import job_folder
from tools.step11_watchlist_extract import extract_call


# --------------------------------------------------------------------------- #
# Build from a saved job
# --------------------------------------------------------------------------- #
def _f(v) -> float | None:
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        s = str(v).replace(",", "").replace("₹", "").strip()
        return float(s) if s not in ("", "nan", "None") else None
    except (TypeError, ValueError):
        return None


def _s(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip()
    return s or None


def _analyst_names(db: Session, job_id) -> str | None:
    rows = db.scalars(select(JobAnalyst).where(JobAnalyst.job_id == job_id)).all()
    names = []
    for r in rows:
        a = db.get(Analyst, r.analyst_id)
        if a:
            names.append(a.name)
    return ", ".join(names) if names else None


def build_from_job(db: Session, job: Job, *, created_by=None, overrides: dict | None = None) -> int:
    """(Re)build watchlist rows for one saved job. Returns the number created."""
    stocks_csv = os.path.join(job_folder(job.id), "analysis", "stocks_with_charts.csv")
    if not os.path.exists(stocks_csv):
        # Fall back to the pre-chart CMP file if charts were skipped.
        alt = os.path.join(job_folder(job.id), "analysis", "stocks_with_cmp.csv")
        stocks_csv = alt if os.path.exists(alt) else stocks_csv
    if not os.path.exists(stocks_csv):
        return 0

    df = pd.read_csv(stocks_csv, encoding="utf-8-sig")
    df.columns = [c.strip().upper() for c in df.columns]

    platform = db.get(Platform, job.platform_id) if job.platform_id else None
    analyst_names = _analyst_names(db, job.id)

    # Idempotent: clear any previous rows for this job before rebuilding.
    db.execute(delete(WatchlistCall).where(WatchlistCall.job_id == job.id))

    created = 0
    for _, row in df.iterrows():
        symbol = _s(row.get("STOCK SYMBOL"))
        short = _s(row.get("SHORT NAME")) or _s(row.get("INPUT STOCK"))
        listed = _s(row.get("LISTED NAME")) or _s(row.get("INPUT STOCK"))
        if not (symbol or short or listed):
            continue
        analysis = _s(row.get("ANALYSIS")) or ""
        ex = extract_call(analysis, short or listed or symbol or "", overrides)
        try:
            ct = CallType(ex.get("call_type", "no_view"))
        except ValueError:
            ct = CallType.no_view

        chart_rel = _s(row.get("CHART PATH"))

        call = WatchlistCall(
            job_id=job.id,
            platform_name=(platform.channel_name if platform else None),
            platform_type=(platform.platform_type.value if platform else None),
            channel_logo_path=(platform.channel_logo_path if platform else None),
            analyst_names=analyst_names,
            call_date=job.video_date,
            call_time=job.video_time,
            stock_symbol=symbol,
            short_name=short,
            listed_name=listed,
            security_id=_s(row.get("SECURITY ID")),
            exchange=(_s(row.get("EXCHANGE")) or "NSE"),
            instrument=(_s(row.get("INSTRUMENT")) or "EQUITY"),
            chart_path=chart_rel,
            call_type=ct,
            call_cmp=_f(row.get("CMP")),
            targets=ex.get("targets", []),
            stoploss=ex.get("stoploss"),
            downfall_target=ex.get("downfall_target"),
            holding_period=ex.get("holding_period"),
            holding_period_days=ex.get("holding_period_days"),
            analysis_text=analysis or None,
            raw_extraction={k: v for k, v in ex.items() if k != "_raw"},
            created_by=created_by,
        )
        db.add(call)
        created += 1

    db.commit()
    return created


# --------------------------------------------------------------------------- #
# CMP refresh (peak high / trough low since call)
# --------------------------------------------------------------------------- #
def refresh_call_cmp(db: Session, call: WatchlistCall) -> bool:
    """Update one call's tracking fields from Dhan. Returns True on success."""
    if not call.security_id:
        return False
    start = call.call_date or (call.created_at.date() if call.created_at else dt.date.today())
    data = dhan.fetch_tracking(call.security_id, call.exchange or "NSE", call.instrument or "EQUITY", start)
    if not data:
        return False
    call.current_cmp = data.get("current_cmp")
    call.peak_high = data.get("peak_high")
    call.trough_low = data.get("trough_low")
    call.cmp_fetched_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return True


def refresh_many(db: Session, calls: list[WatchlistCall], *, sleep_secs: float = 0.15) -> dict:
    ok = fail = 0
    for c in calls:
        try:
            if refresh_call_cmp(db, c):
                ok += 1
            else:
                fail += 1
        except Exception:  # noqa: BLE001
            db.rollback()
            fail += 1
        if sleep_secs:
            time.sleep(sleep_secs)
    return {"updated": ok, "failed": fail, "total": len(calls)}


# --------------------------------------------------------------------------- #
# Derivation (pure)
# --------------------------------------------------------------------------- #
def _targets_status(call_type: str, targets, peak_high, trough_low) -> list[dict]:
    out = []
    bullish = call_type in ("buy", "hold")
    for t in targets or []:
        achieved = False
        if bullish and peak_high is not None:
            achieved = peak_high >= t
        elif call_type == "sell" and trough_low is not None:
            achieved = trough_low <= t
        out.append({"value": t, "achieved": bool(achieved)})
    return out


def compute_view(call) -> dict:
    """Pure derivation used by the serializer. `call` exposes the model fields."""
    ct = call.call_type.value if hasattr(call.call_type, "value") else str(call.call_type)
    targets = list(call.targets or [])
    tstatus = _targets_status(ct, targets, call.peak_high, call.trough_low)
    achieved_count = sum(1 for t in tstatus if t["achieved"])

    # Downfall achievement (sell or explicit downside level).
    downfall_hit = False
    if call.downfall_target is not None and call.trough_low is not None:
        downfall_hit = call.trough_low <= call.downfall_target

    any_hit = achieved_count > 0 or downfall_hit
    status = "achieved" if any_hit else "awaited"

    # P/L only for buy/hold; never for sell or no_view.
    pnl_abs = pnl_pct = None
    if ct in ("buy", "hold") and call.current_cmp is not None and call.call_cmp:
        pnl_abs = round(call.current_cmp - call.call_cmp, 2)
        pnl_pct = round((call.current_cmp - call.call_cmp) / call.call_cmp * 100, 2)

    # Days since the call.
    days_since = None
    base = call.call_date or (call.created_at.date() if getattr(call, "created_at", None) else None)
    if base:
        days_since = (dt.date.today() - base).days

    holding_elapsed = None
    if days_since is not None and call.holding_period_days:
        holding_elapsed = days_since >= call.holding_period_days

    # Row highlight: achieved -> green, loss (buy/hold pnl<0) -> red, else neutral/white.
    if status == "achieved":
        highlight = "achieved"
    elif pnl_abs is not None and pnl_abs < 0:
        highlight = "loss"
    else:
        highlight = "neutral"

    return {
        "targets_status": tstatus,
        "achieved_count": achieved_count,
        "total_targets": len(targets),
        "downfall_hit": downfall_hit,
        "status": status,
        "pnl_abs": pnl_abs,
        "pnl_pct": pnl_pct,
        "days_since": days_since,
        "holding_elapsed": holding_elapsed,
        "highlight": highlight,
    }
