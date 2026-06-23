"""Dhan API client (Steps 8 & 9 + standalone chart).

A thin, FastAPI-friendly facade over the Dhan market-data engine that already
lives in the pipeline tools. It centralises:

  * the access-token header (key decrypted from api_keys 'dhan'),
  * CMP lookup (intraday 5-min -> historical fallback, last close),
  * chart-data assembly (daily 8-month history + 1-min partial last candle,
    with a last-trading-day fallback), and
  * PNG rendering via the bulk chart engine (make_premium_chart).

The heavy fetch/draw logic is imported from the step08/step09 tools so there is
a single, unit-tested implementation rather than a divergent copy. The Excel
date/time normalizers are re-exported from step08 unchanged.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta

import pandas as pd
from dateutil.relativedelta import relativedelta
from fastapi import HTTPException, status

from core.config import settings
from tools.step08_fetch_cmp.runtime import (  # re-exported normalizers + cmp engine
    _fetch_cmp_for_stock,
    normalize_date_format,
    normalize_time_format,
)
from tools.step09_generate_charts.runtime import (
    IST,
    add_indicators,
    get_daily_history,
    get_intraday_1m,
    get_last_trading_day_close,
    make_premium_chart,
    parse_date,
    parse_time,
    resample_to,
)
from utils.database import get_api_key

__all__ = [
    "normalize_date_format",
    "normalize_time_format",
    "get_headers",
    "fetch_cmp",
    "fetch_chart_df",
    "render_chart_png",
]

GENERATED_CHARTS_SUBDIR = "generated-charts"


def get_headers() -> dict:
    """Build the Dhan auth header, or raise a clean 400 if the key is missing."""
    key = get_api_key("dhan")
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dhan API key is not configured. Add it under Manage API Keys.",
        )
    return {"Content-Type": "application/json", "Accept": "application/json", "access-token": key}


def fetch_cmp(security_id: str, exchange: str, date_str: str, time_str: str) -> float | None:
    """Current market price at the given date/time.

    Normalizes the inputs (Excel formats tolerated), then runs the step-8 engine:
    intraday 5-min candles, falling back to daily historical; returns last close.
    """
    headers = get_headers()
    norm_date = normalize_date_format(date_str)
    if not norm_date:
        raise HTTPException(status_code=400, detail=f"Unrecognized date: {date_str!r}")
    norm_time = normalize_time_format(time_str)
    sid = str(security_id).split(".")[0].strip()
    if not sid or sid == "nan":
        raise HTTPException(status_code=400, detail="A valid security_id is required.")
    cmp = _fetch_cmp_for_stock(sid, str(exchange).strip().upper() or "NSE", norm_date, norm_time, headers)
    return round(float(cmp), 2) if cmp else None


def fetch_chart_df(
    security_id: str,
    exchange: str,
    date_str: str,
    time_str: str,
    chart_type: str = "Daily",
    history_months: int = 8,
    ma_periods=(20, 50, 100, 200),
    rsi_period: int = 14,
) -> pd.DataFrame:
    """Assemble an indicator-rich OHLCV DataFrame for one stock.

    Daily history (history_months back) + a 1-min partial last candle, resampled
    to the requested timeframe. If there is no data for the requested moment, we
    fall back to the last completed trading day (same as the bulk pipeline).
    Returns a DataFrame already carrying MA20/50/100/200 + RSI(14).
    """
    headers = get_headers()
    sid = str(security_id).split(".")[0].strip()
    if not sid or sid == "nan":
        raise HTTPException(status_code=400, detail="A valid security_id is required.")
    exchange = str(exchange).strip().upper() or "NSE"
    exchange_segment = f"{exchange}_EQ" if exchange in ("NSE", "BSE") else "NSE_EQ"
    chart_type = (chart_type or "Daily").strip() or "Daily"

    norm_date = normalize_date_format(date_str) or date_str
    date_obj = parse_date(norm_date)
    h, m, s = parse_time(normalize_time_format(time_str))
    end_dt_local = IST.localize(datetime(date_obj.year, date_obj.month, date_obj.day, h, m, s))

    def _assemble(d_obj, end_local):
        start_hist = d_obj - relativedelta(months=history_months)
        end_hist_non_inclusive = d_obj + timedelta(days=1)
        daily = get_daily_history(sid, start_hist, end_hist_non_inclusive, headers, exchange_segment)
        market_open = IST.localize(datetime(d_obj.year, d_obj.month, d_obj.day, 9, 15, 0))
        if end_local <= market_open:
            intraday = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        else:
            intraday = get_intraday_1m(sid, market_open, end_local, headers, exchange_segment)
        return resample_to(daily, chart_type, intraday)

    try:
        df_tf = _assemble(date_obj, end_dt_local)
        if df_tf.empty:
            raise ValueError("No data for requested date/time")
    except Exception:
        last_close = get_last_trading_day_close(end_dt_local)
        df_tf = _assemble(last_close.date(), last_close)
        if df_tf.empty:
            raise HTTPException(status_code=404, detail="No market data available for this stock/date.")

    return add_indicators(df_tf, list(ma_periods), rsi_period)


def render_chart_png(
    security_id: str,
    exchange: str,
    date_str: str,
    time_str: str,
    chart_type: str = "Daily",
    short_name: str = "",
    cmp_value: float | None = None,
) -> tuple[str, str, float | None]:
    """Generate a premium chart PNG for one stock.

    Returns (absolute_filesystem_path, public_url, cmp) where public_url is
    served by the app's /uploads static mount. CMP is fetched if not supplied.
    """
    df = fetch_chart_df(security_id, exchange, date_str, time_str, chart_type)

    norm_date = normalize_date_format(date_str) or date_str
    date_obj = parse_date(norm_date)
    h, m, s = parse_time(normalize_time_format(time_str))
    cmp_datetime = IST.localize(datetime(date_obj.year, date_obj.month, date_obj.day, h, m, s))

    if cmp_value is None:
        try:
            cmp_value = fetch_cmp(security_id, exchange, date_str, time_str)
        except HTTPException:
            cmp_value = None

    out_dir = os.path.abspath(os.path.join(settings.UPLOAD_DIR, GENERATED_CHARTS_SUBDIR))
    os.makedirs(out_dir, exist_ok=True)
    fname = f"{str(security_id).split('.')[0]}_{chart_type}_{date_obj.strftime('%Y%m%d')}_{uuid.uuid4().hex[:8]}.png"
    save_path = os.path.join(out_dir, fname)

    meta = {
        "SHORT NAME": short_name or str(security_id),
        "CHART TYPE": chart_type,
        "EXCHANGE": str(exchange).strip().upper() or "NSE",
    }
    make_premium_chart(df, meta, save_path, cmp_value, cmp_datetime)
    public_url = f"/uploads/{GENERATED_CHARTS_SUBDIR}/{fname}"
    return save_path, public_url, cmp_value
