"""Runtime for Step 8 — Fetch CMP (Dhan API).

Ported from the reference. Date/time normalizers kept verbatim (handle Excel/
Windows formats). Dhan key comes from get_api_key('dhan'); intraday then
historical fallback; last close used.
"""
from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta

import pandas as pd
import requests

from tools.step08_fetch_cmp.schema import get_effective_config
from utils.database import get_api_key


def normalize_date_format(date_str):
    if date_str is None or (isinstance(date_str, float) and pd.isna(date_str)):
        return None
    date_str = str(date_str).strip()
    if not date_str or date_str.lower() in ["nan", "none", "nat", ""]:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return date_str
    try:
        num_val = float(date_str)
        if 40000 < num_val < 60000:
            return (datetime(1899, 12, 30) + timedelta(days=int(num_val))).strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        pass
    date_formats = [
        "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d", "%Y.%m.%d", "%m/%d/%Y", "%m-%d-%Y",
        "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%m/%d/%y", "%m-%d-%y", "%y/%m/%d", "%y-%m-%d",
        "%d-%b-%Y", "%d %b %Y", "%d-%b-%y", "%d %b %y", "%b %d, %Y", "%b %d %Y",
        "%B %d, %Y", "%B %d %Y", "%d %B %Y", "%d-%B-%Y",
        "%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%m/%d/%Y %H:%M:%S", "%d-%m-%Y %H:%M:%S",
    ]
    for fmt in date_formats:
        try:
            dt = datetime.strptime(date_str, fmt)
            if dt.year < 100:
                dt = dt.replace(year=dt.year + 2000)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    for dayfirst in (True, False):
        try:
            dt = pd.to_datetime(date_str, dayfirst=dayfirst)
            if not pd.isna(dt):
                return dt.strftime("%Y-%m-%d")
        except Exception:
            pass
    return None


def normalize_time_format(time_str):
    if time_str is None or (isinstance(time_str, float) and pd.isna(time_str)):
        return "10:00:00"
    time_str = str(time_str).strip()
    if not time_str or time_str.lower() in ["nan", "none", "nat", ""]:
        return "10:00:00"
    try:
        num_val = float(time_str)
        if 0 <= num_val < 1:
            total = int(num_val * 86400)
            return f"{total // 3600:02d}:{(total % 3600) // 60:02d}:{total % 60:02d}"
    except (ValueError, TypeError):
        pass
    m = re.match(r"^(\d{1,2}):(\d{2}):(\d{2})$", time_str)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59:
            return f"{h:02d}:{mi:02d}:{s:02d}"
    m = re.match(r"^(\d{1,2})[.\-](\d{2})[.\-](\d{2})$", time_str)
    if m:
        h, mi, s = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59:
            return f"{h:02d}:{mi:02d}:{s:02d}"
    m = re.match(r"^(\d{1,2}):(\d{2})$", time_str)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return f"{h:02d}:{mi:02d}:00"
    m = re.match(r"^(\d{1,2})[.\-](\d{2})$", time_str)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return f"{h:02d}:{mi:02d}:00"
    m = re.match(r"^(\d{1,2})[:.\-]?(\d{2})[:.\-]?(\d{2})?\s*(AM|PM|am|pm|A\.M\.|P\.M\.)$", time_str, re.IGNORECASE)
    if m:
        h = int(m.group(1)); mi = int(m.group(2)) if m.group(2) else 0; s = int(m.group(3)) if m.group(3) else 0
        period = m.group(4).upper().replace(".", "")
        if period == "PM" and h != 12:
            h += 12
        elif period == "AM" and h == 12:
            h = 0
        if 0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59:
            return f"{h:02d}:{mi:02d}:{s:02d}"
    m = re.match(r"^(\d{1,2})\s*(AM|PM|am|pm|A\.M\.|P\.M\.)$", time_str, re.IGNORECASE)
    if m:
        h = int(m.group(1)); period = m.group(2).upper().replace(".", "")
        if period == "PM" and h != 12:
            h += 12
        elif period == "AM" and h == 12:
            h = 0
        if 0 <= h <= 23:
            return f"{h:02d}:00:00"
    if re.match(r"^\d{5,6}$", time_str):
        z = time_str.zfill(6); h, mi, s = int(z[0:2]), int(z[2:4]), int(z[4:6])
        if 0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59:
            return f"{h:02d}:{mi:02d}:{s:02d}"
    if re.match(r"^\d{3,4}$", time_str):
        z = time_str.zfill(4); h, mi = int(z[0:2]), int(z[2:4])
        if 0 <= h <= 23 and 0 <= mi <= 59:
            return f"{h:02d}:{mi:02d}:00"
    for fmt in ["%I:%M:%S %p", "%I:%M %p", "%I %p", "%I:%M:%S%p", "%I:%M%p", "%I%p", "%H:%M:%S", "%H:%M"]:
        try:
            return datetime.strptime(time_str, fmt).strftime("%H:%M:%S")
        except ValueError:
            continue
    return "10:00:00"


def _fetch_cmp_for_stock(security_id, exchange, date_str, time_str, headers):
    try:
        exchange_segment = f"{exchange}_EQ"
        try:
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M:%S")
        except ValueError:
            dt = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        from_time = dt.replace(hour=9, minute=15, second=0)
        to_time = dt + timedelta(minutes=10)
        payload = {
            "securityId": str(security_id), "exchangeSegment": exchange_segment, "instrument": "EQUITY",
            "interval": "5", "fromDate": from_time.strftime("%Y-%m-%d %H:%M:%S"),
            "toDate": to_time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        r = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("close"):
                return data["close"][-1]
        hist = {
            "securityId": str(security_id), "exchangeSegment": exchange_segment, "instrument": "EQUITY",
            "expiryCode": 0, "fromDate": (dt - timedelta(days=5)).strftime("%Y-%m-%d"),
            "toDate": dt.strftime("%Y-%m-%d"),
        }
        r = requests.post("https://api.dhan.co/v2/charts/historical", headers=headers, json=hist, timeout=30)
        if r.status_code == 200:
            data = r.json()
            if data.get("close"):
                return data["close"][-1]
        return None
    except Exception as e:
        print(f"      Error fetching CMP: {e}")
        return None


def run(job_folder):
    print("\n" + "=" * 60)
    print("STEP 8: FETCH CMP")
    print("=" * 60)
    try:
        cfg = get_effective_config()
        sleep_secs = float(cfg.get("inter_request_sleep_secs", 0.5))
        analysis_folder = os.path.join(job_folder, "analysis")
        input_file = os.path.join(analysis_folder, "mapped_master_file.csv")
        output_file = os.path.join(analysis_folder, "stocks_with_cmp.csv")
        if not os.path.exists(input_file):
            return {"success": False, "error": f"Mapped file not found: {input_file}"}
        dhan_key = get_api_key("dhan")
        if not dhan_key:
            return {"success": False, "error": "Dhan API key not found. Add it under Manage API Keys."}
        headers = {"Content-Type": "application/json", "Accept": "application/json", "access-token": dhan_key}

        df = pd.read_csv(input_file)
        if "CMP" not in df.columns:
            df["CMP"] = None
        success_count = failed_count = 0
        for i, row in df.iterrows():
            stock_name = row.get("INPUT STOCK", row.get("STOCK NAME", f"Row {i}"))
            security_id = str(row.get("SECURITY ID", "")).strip()
            if "." in security_id:
                security_id = security_id.split(".")[0]
            if not security_id or security_id in ("", "nan"):
                failed_count += 1
                continue
            exchange = str(row.get("EXCHANGE", "NSE")).strip()
            date_str = normalize_date_format(str(row.get("DATE", "")).strip())
            if not date_str:
                failed_count += 1
                continue
            time_str = normalize_time_format(str(row.get("TIME", "10:00:00")).strip())
            df.at[i, "DATE"] = date_str
            df.at[i, "TIME"] = time_str
            cmp = _fetch_cmp_for_stock(security_id, exchange, date_str, time_str, headers)
            if cmp:
                df.at[i, "CMP"] = round(cmp, 2)
                success_count += 1
            else:
                failed_count += 1
            if sleep_secs > 0:
                time.sleep(sleep_secs)
        df.to_csv(output_file, index=False, encoding="utf-8-sig")
        print(f"✅ CMP: {success_count} ok / {failed_count} failed → {output_file}")
        return {"success": True, "output_file": output_file,
                "success_count": success_count, "failed_count": failed_count}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
