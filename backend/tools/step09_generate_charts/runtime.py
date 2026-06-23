"""Runtime for Step 9 — Generate Charts (Dhan API + mplfinance).

Ported from the reference premium-chart generator. Chart drawing logic (candles,
volume, MA20/50/100/200, RSI(14), CMP line) is kept faithful to the original.

Changes vs reference:
  * Dhan key comes from utils.database.get_api_key("dhan") (not a raw SELECT).
  * All numeric knobs come from get_effective_config() so they are admin-tunable.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import mplfinance as mpf  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytz  # noqa: E402
import requests  # noqa: E402
from dateutil.relativedelta import relativedelta  # noqa: E402

from tools.step09_generate_charts.schema import get_effective_config  # noqa: E402
from utils.database import get_api_key  # noqa: E402

IST = pytz.timezone("Asia/Kolkata")
BASE_URL = "https://api.dhan.co/v2"
MARKET_OPEN_TIME = (9, 15)
MARKET_CLOSE_TIME = (15, 30)


def get_last_trading_day_close(dt_local: datetime) -> datetime:
    """Find the last trading day's closing time (3:30 PM)."""
    market_close_minutes = MARKET_CLOSE_TIME[0] * 60 + MARKET_CLOSE_TIME[1]
    requested_minutes = dt_local.hour * 60 + dt_local.minute
    if requested_minutes < market_close_minutes:
        search_date = dt_local.date() - timedelta(days=1)
    else:
        search_date = dt_local.date()
    while search_date.weekday() >= 5:
        search_date = search_date - timedelta(days=1)
    return IST.localize(datetime(
        search_date.year, search_date.month, search_date.day,
        MARKET_CLOSE_TIME[0], MARKET_CLOSE_TIME[1], 0,
    ))


def parse_date(s: str):
    s = str(s).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized DATE format: {s!r}")


def parse_time(s: str):
    s = str(s).strip().replace(".", ":")
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.hour, dt.minute, getattr(dt, "second", 0)
        except ValueError:
            continue
    return 15, 30, 0


def _post(path: str, payload: dict, headers: dict, max_retries: int = 4, timeout: int = 30) -> dict:
    for attempt in range(max_retries):
        try:
            r = requests.post(f"{BASE_URL}{path}", headers=headers, json=payload, timeout=timeout)
            if r.ok:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            r.raise_for_status()
        except requests.exceptions.RequestException:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError("Max retries exceeded")


def _is_empty_payload(d: dict) -> bool:
    if not isinstance(d, dict) or not d:
        return True
    for key in ("open", "high", "low", "close", "volume", "timestamp"):
        arr = d.get(key, [])
        if isinstance(arr, list) and len(arr) > 0:
            return False
    return True


def zip_candles(d: dict) -> pd.DataFrame:
    if _is_empty_payload(d):
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    cols = ["open", "high", "low", "close", "volume", "timestamp"]
    n = min(len(d.get(c, [])) for c in cols if c in d)
    if n == 0:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    df = pd.DataFrame({c: d[c][:n] for c in cols})
    dt = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.tz_convert(IST)
    df = df.assign(datetime=dt).set_index("datetime").drop(columns=["timestamp"])
    for c in ["open", "high", "low", "close", "volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=["open", "high", "low", "close"]).sort_index()


def get_daily_history(security_id, start_date, end_date_non_inclusive, headers,
                      exchange_segment="NSE_EQ", max_retries=4, timeout=30) -> pd.DataFrame:
    payload = {
        "securityId": str(security_id), "exchangeSegment": exchange_segment,
        "instrument": "EQUITY", "expiryCode": 0, "oi": False,
        "fromDate": start_date.strftime("%Y-%m-%d"),
        "toDate": end_date_non_inclusive.strftime("%Y-%m-%d"),
    }
    return zip_candles(_post("/charts/historical", payload, headers, max_retries, timeout))


def get_intraday_1m(security_id, from_dt_local, to_dt_local, headers,
                    exchange_segment="NSE_EQ", max_retries=4, timeout=30) -> pd.DataFrame:
    payload = {
        "securityId": str(security_id), "exchangeSegment": exchange_segment,
        "instrument": "EQUITY", "interval": "1", "oi": False,
        "fromDate": from_dt_local.strftime("%Y-%m-%d %H:%M:%S"),
        "toDate": to_dt_local.strftime("%Y-%m-%d %H:%M:%S"),
    }
    return zip_candles(_post("/charts/intraday", payload, headers, max_retries, timeout))


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    if len(series) < 2:
        return pd.Series([np.nan] * len(series), index=series.index)
    delta = series.diff()
    up = np.where(delta > 0, delta, 0.0)
    down = np.where(delta < 0, -delta, 0.0)
    roll_up = pd.Series(up, index=series.index).ewm(alpha=1 / period, adjust=False).mean()
    roll_down = pd.Series(down, index=series.index).ewm(alpha=1 / period, adjust=False).mean()
    with np.errstate(divide="ignore", invalid="ignore"):
        rs = roll_up / roll_down.replace(0, np.nan)
        r = 100 - (100 / (1 + rs))
    return r


def add_indicators(df: pd.DataFrame, ma_periods, rsi_period) -> pd.DataFrame:
    out = df.copy()
    for n in ma_periods:
        out[f"MA{n}"] = out["close"].rolling(n, min_periods=1).mean()
    out["RSI14"] = rsi(out["close"], rsi_period)
    return out


def _aggregate_partial(df_1m: pd.DataFrame):
    if df_1m is None or df_1m.empty:
        return None
    return pd.Series({
        "open": df_1m["open"].iloc[0], "high": df_1m["high"].max(),
        "low": df_1m["low"].min(), "close": df_1m["close"].iloc[-1],
        "volume": df_1m["volume"].sum(),
    })


def resample_to(df_daily: pd.DataFrame, chart_type: str, intraday_partial: pd.DataFrame) -> pd.DataFrame:
    if df_daily is None or df_daily.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    chart_type = (chart_type or "").strip().lower()
    if chart_type == "daily":
        df = df_daily.copy()
        part = _aggregate_partial(intraday_partial)
        if part is not None:
            day = intraday_partial.index[-1].date()
            idx = IST.localize(datetime(day.year, day.month, day.day, 15, 30))
            df = df[df.index.date != day]
            partial_df = pd.DataFrame(part).T
            partial_df.index = [idx]
            df = pd.concat([df, partial_df]).sort_index()
        return df
    return df_daily.copy()


def _pad_right(df: pd.DataFrame, n_steps: int = 6) -> pd.DataFrame:
    if df is None or df.empty or len(df.index) < 2:
        return df
    idx = df.index
    try:
        step = idx[-1] - idx[-2]
        if step <= pd.Timedelta(0):
            step = pd.Timedelta(days=1)
    except Exception:
        step = pd.Timedelta(days=1)
    fut = [idx[-1] + (i * step) for i in range(1, n_steps + 1)]
    pad = pd.DataFrame(np.nan, index=pd.DatetimeIndex(fut, tz=idx.tz),
                       columns=["open", "high", "low", "close", "volume"])
    return pd.concat([df, pad])


def make_premium_chart(df, meta, save_path, cmp_value=None, cmp_datetime=None,
                       ma_periods=(20, 50, 100, 200), dpi=150, figsize=(14, 7)):
    if df is None or df.empty or len(df) == 0:
        raise ValueError("No data to plot.")
    df_plot = df[["open", "high", "low", "close", "volume"]].copy()
    df_plot = _pad_right(df_plot, n_steps=3)
    df_aligned = df.reindex(df_plot.index)

    ma_colors = {"MA20": "#1f77b4", "MA50": "#ff7f0e", "MA100": "#2ca02c", "MA200": "#d62728"}
    ma_cols = [f"MA{n}" for n in ma_periods]

    ap = []
    for c in ma_cols:
        if c in df_aligned.columns and df_aligned[c].notna().sum() >= 2:
            ap.append(mpf.make_addplot(df_aligned[c], panel=0, type="line",
                                       width=1.2, color=ma_colors.get(c, "#888888")))
    have_rsi = ("RSI14" in df_aligned.columns and df_aligned["RSI14"].notna().sum() >= 2)
    if have_rsi:
        ap.append(mpf.make_addplot(df_aligned["RSI14"], panel=2, type="line",
                                   ylabel="RSI(14)", ylim=(0, 100)))

    mc = mpf.make_marketcolors(up="g", down="r", edge="inherit", wick="inherit", volume="inherit")
    s = mpf.make_mpf_style(marketcolors=mc, gridstyle="-", gridcolor="#e8e8e8", y_on_right=True)

    fig, axes = mpf.plot(df_plot, type="candle", style=s, addplot=ap, volume=True,
                         panel_ratios=(6, 2, 2) if have_rsi else (6, 2), returnfig=True,
                         figsize=tuple(figsize), datetime_format="%d %b %y", tight_layout=False)

    ax_price = axes[0]
    ax_price.yaxis.set_ticks_position("right")
    ax_price.yaxis.tick_right()
    fig.subplots_adjust(left=0.06, right=0.94, top=0.95, bottom=0.08)

    last_ts = df.index[-1]
    last_close = float(df["close"].iloc[-1])
    cmp_display = cmp_value if cmp_value is not None else last_close
    display_ts = cmp_datetime if cmp_datetime is not None else last_ts

    last_ts_str = last_ts.astimezone(IST).strftime("%a %d %b %y • %H:%M:%S")
    cmp_date_only = display_ts.astimezone(IST).strftime("%d %b %Y")
    cmp_time_only = display_ts.astimezone(IST).strftime("%H:%M:%S")

    ax_price.set_xlabel(f"Last (running) candle close: {last_ts_str}", fontsize=10)
    ax_price.text(0.01, 0.98,
                  f"{meta.get('SHORT NAME', '')}  •  {meta.get('CHART TYPE', '')}  •  {meta.get('EXCHANGE', '')}",
                  transform=ax_price.transAxes, ha="left", va="top", fontsize=12, fontweight="bold")

    legend_lines, legend_labels = [], []
    for c in ma_cols:
        if c in df_aligned.columns:
            line, = ax_price.plot([], [], lw=2, color=ma_colors.get(c, "#888888"))
            legend_lines.append(line)
            legend_labels.append(c)
    if legend_lines:
        leg = ax_price.legend(legend_lines, legend_labels, loc="upper left",
                              bbox_to_anchor=(0.006, 0.90), frameon=True, framealpha=0.9,
                              borderpad=0.6, fontsize=9)
        try:
            leg.get_frame().set_boxstyle("Round,pad=0.3,rounding_size=2")
        except Exception:
            pass

    ax_price.axhline(cmp_display, linestyle="--", linewidth=1.2, color="#666666", alpha=0.7)
    mid_position = int(len(df.index) * 0.5)
    ax_price.text(mid_position, cmp_display, f"  CMP: ₹{cmp_display:.2f}",
                  ha="left", va="center", fontsize=10, fontweight="bold",
                  bbox=dict(boxstyle="round,pad=0.4", fc="#ffffcc", ec="#999999", alpha=0.95), zorder=10)
    ax_price.text(0.98, 0.02, f"CMP: ₹{cmp_display:.2f}\n{cmp_date_only}\n{cmp_time_only}",
                  transform=ax_price.transAxes, ha="right", va="bottom", fontsize=9,
                  bbox=dict(boxstyle="round,pad=0.5", fc="white", ec="#666666", alpha=0.90), zorder=10)

    if have_rsi and len(axes) >= 3:
        ax_rsi = axes[2]
        ax_rsi.axhline(70, linestyle=":", linewidth=0.8, color="red", alpha=0.5)
        ax_rsi.axhline(30, linestyle=":", linewidth=0.8, color="green", alpha=0.5)

    fig.savefig(save_path, dpi=dpi, bbox_inches="tight", pad_inches=0.1)
    plt.close(fig)


def run(job_folder, call_date=None, call_time=None):
    """Generate premium charts for every stock in stocks_with_cmp.csv.

    Pauses are handled by the orchestrator: failed charts are returned in
    'failed_charts' so the user can upload a replacement image per stock.
    """
    print("\n" + "=" * 60)
    print("STEP 9: GENERATE STOCK CHARTS (PREMIUM DESIGN)")
    print("=" * 60 + "\n")
    try:
        cfg = get_effective_config()
        history_months = int(cfg.get("history_months", 8))
        ma_periods = cfg.get("ma_periods", [20, 50, 100, 200])
        rsi_period = int(cfg.get("rsi_period", 14))
        sleep_secs = float(cfg.get("inter_request_sleep_secs", 1.5))
        dpi = int(cfg.get("dpi", 150))
        figsize = cfg.get("figsize", [14, 7])
        max_retries = int(cfg.get("max_retries", 4))
        timeout = int(cfg.get("request_timeout_seconds", 30))

        analysis_folder = os.path.join(job_folder, "analysis")
        charts_folder = os.path.join(job_folder, "charts")
        input_file = os.path.join(analysis_folder, "stocks_with_cmp.csv")
        output_file = os.path.join(analysis_folder, "stocks_with_charts.csv")
        failed_charts_file = os.path.join(analysis_folder, "failed_charts.json")
        os.makedirs(charts_folder, exist_ok=True)

        if not os.path.exists(input_file):
            return {"success": False, "error": f"Input file not found: {input_file}"}

        dhan_key = get_api_key("dhan")
        if not dhan_key:
            return {"success": False, "error": "Dhan API key not found. Add it under Manage API Keys."}
        headers = {"Content-Type": "application/json", "Accept": "application/json", "access-token": dhan_key}

        df = pd.read_csv(input_file)
        print(f"✅ Loaded {len(df)} stocks")
        if "CHART PATH" not in df.columns:
            df["CHART PATH"] = ""
        if "CHART TYPE" not in df.columns:
            df["CHART TYPE"] = "Daily"

        success_count = failed_count = 0
        failed_charts = []

        for idx, row in df.iterrows():
            stock_name = str(row.get("INPUT STOCK", row.get("STOCK NAME", f"Row {idx}"))).strip()
            symbol = str(row.get("STOCK SYMBOL", "")).strip()
            short_name = str(row.get("SHORT NAME", symbol)).strip()
            security_id = str(row.get("SECURITY ID", "")).strip()
            if "." in security_id:
                security_id = security_id.split(".")[0]
            try:
                if not security_id or security_id in ("", "nan"):
                    print(f"  ⚠️ [{idx + 1}/{len(df)}] {stock_name:25} | Skipping - No SECURITY ID")
                    failed_charts.append({"index": int(idx), "stock_name": stock_name, "symbol": symbol,
                                          "short_name": short_name, "security_id": "",
                                          "error": "No SECURITY ID found in master data"})
                    failed_count += 1
                    continue

                exchange = str(row.get("EXCHANGE", "NSE")).strip().upper()
                exchange_segment = f"{exchange}_EQ" if exchange in ["NSE", "BSE"] else "NSE_EQ"
                chart_type = str(row.get("CHART TYPE", "Daily")).strip() or "Daily"
                date_str = str(call_date).strip() if call_date else str(row.get("DATE", "")).strip()
                time_str = str(call_time).strip() if call_time else str(row.get("TIME", "15:30:00")).strip()

                cmp = row.get("CMP", None)
                if pd.isna(cmp):
                    cmp = None
                else:
                    try:
                        cmp = float(cmp)
                    except (ValueError, TypeError):
                        cmp = None

                print(f"  [{idx + 1}/{len(df)}] {stock_name[:25]:25} ({chart_type}, {exchange})...")
                date_obj = parse_date(date_str)
                h, m, s = parse_time(time_str)
                end_dt_local = IST.localize(datetime(date_obj.year, date_obj.month, date_obj.day, h, m, s))

                try:
                    start_hist = date_obj - relativedelta(months=history_months)
                    end_hist_non_inclusive = date_obj + timedelta(days=1)
                    daily = get_daily_history(security_id, start_hist, end_hist_non_inclusive,
                                              headers, exchange_segment, max_retries, timeout)
                    market_open = IST.localize(datetime(date_obj.year, date_obj.month, date_obj.day, 9, 15, 0))
                    if end_dt_local <= market_open:
                        intraday = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
                    else:
                        intraday = get_intraday_1m(security_id, market_open, end_dt_local,
                                                   headers, exchange_segment, max_retries, timeout)
                    df_tf = resample_to(daily, chart_type, intraday)
                    if df_tf.empty or len(df_tf) == 0:
                        raise ValueError("No data for requested date/time")
                except Exception:
                    print("      ℹ️ No data for requested date, falling back to last trading day...")
                    last_close = get_last_trading_day_close(end_dt_local)
                    last_date = last_close.date()
                    start_hist = last_date - relativedelta(months=history_months)
                    end_hist_non_inclusive = last_date + timedelta(days=1)
                    daily = get_daily_history(security_id, start_hist, end_hist_non_inclusive,
                                              headers, exchange_segment, max_retries, timeout)
                    market_open = IST.localize(datetime(last_date.year, last_date.month, last_date.day, 9, 15, 0))
                    intraday = get_intraday_1m(security_id, market_open, last_close,
                                               headers, exchange_segment, max_retries, timeout)
                    df_tf = resample_to(daily, chart_type, intraday)
                    if df_tf.empty:
                        raise ValueError("No data available even for last trading day")

                df_tf = add_indicators(df_tf, ma_periods, rsi_period)
                cmp_datetime = IST.localize(datetime(date_obj.year, date_obj.month, date_obj.day, h, m, s))
                fname = f"{security_id}_{chart_type}_{date_obj.strftime('%Y%m%d')}_{h:02d}{m:02d}{s:02d}.png"
                save_path = os.path.join(charts_folder, fname)
                meta = {"SHORT NAME": short_name or symbol, "CHART TYPE": chart_type, "EXCHANGE": exchange}
                make_premium_chart(df_tf, meta, save_path, cmp, cmp_datetime, ma_periods, dpi, figsize)

                df.at[idx, "CHART PATH"] = f"charts/{fname}"
                df.at[idx, "CHART TYPE"] = chart_type
                print(f"      ✅ Chart saved: {fname}")
                success_count += 1
                if sleep_secs > 0:
                    time.sleep(sleep_secs)
            except Exception as e:
                error_msg = str(e)
                print(f"      ❌ Error: {error_msg}")
                df.at[idx, "CHART PATH"] = ""
                failed_charts.append({"index": int(idx), "stock_name": stock_name, "symbol": symbol,
                                      "short_name": short_name, "security_id": security_id,
                                      "error": error_msg})
                failed_count += 1

        df.to_csv(output_file, index=False, encoding="utf-8-sig")
        if failed_charts:
            with open(failed_charts_file, "w", encoding="utf-8") as f:
                json.dump(failed_charts, f, indent=2)
        print(f"\n\U0001f4ca Charts: {success_count} ok / {failed_count} failed → {output_file}")
        return {"success": True, "output_file": output_file, "success_count": success_count,
                "failed_count": failed_count, "failed_charts": failed_charts}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
