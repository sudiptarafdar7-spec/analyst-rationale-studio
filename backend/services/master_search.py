"""Cached scrip-master search + instrument list for the chart / mapping tools.

The full Dhan scrip master is loaded once and cached by (path, mtime). Searches
are filtered by instrument first (so picking the instrument keeps lookups fast).
"""
from __future__ import annotations

import os
import re
import threading

import pandas as pd
from sqlalchemy import select

from db.enums import UploadedFileType
from db.models import UploadedFile
from db.session import SessionLocal
from utils.path_utils import resolve_uploaded_file_path

_REQ = ["SEM_TRADING_SYMBOL", "SEM_CUSTOM_SYMBOL", "SM_SYMBOL_NAME",
        "SEM_SMST_SECURITY_ID", "SEM_EXM_EXCH_ID", "SEM_INSTRUMENT_NAME"]
_lock = threading.Lock()
_cache: dict = {"path": None, "mtime": None, "df": None}

# Friendly labels for the instrument tabs (docs/v2/annexure#instrument).
INSTRUMENT_LABELS = {
    "EQUITY": "Equity", "INDEX": "Index",
    "FUTIDX": "Index Futures", "OPTIDX": "Index Options",
    "FUTSTK": "Stock Futures", "OPTSTK": "Stock Options",
    "FUTCUR": "Currency Futures", "OPTCUR": "Currency Options",
    "FUTCOM": "Commodity Futures", "OPTFUT": "Commodity Options",
}


def _norm(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", str(s).upper())


def _master_path() -> str | None:
    with SessionLocal() as db:
        row = db.scalar(
            select(UploadedFile)
            .where(UploadedFile.file_type == UploadedFileType.masterFile, UploadedFile.is_active.is_(True))
            .order_by(UploadedFile.uploaded_at.desc())
        )
    return resolve_uploaded_file_path(row.file_path) if row else None


def _load_df(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, low_memory=False)
    for c in _REQ:
        df[c] = df[c].astype(str) if c in df.columns else ""
    df["SEM_INSTRUMENT_NAME"] = df["SEM_INSTRUMENT_NAME"].str.upper().str.strip()
    df["__symN"] = df["SEM_TRADING_SYMBOL"].map(_norm)
    df["__custN"] = df["SEM_CUSTOM_SYMBOL"].map(_norm)
    df["__nameN"] = df["SM_SYMBOL_NAME"].map(_norm)
    df["__prio"] = df["SEM_EXM_EXCH_ID"].astype(str).str.upper().map(
        lambda x: 1 if x == "NSE" else (2 if x == "BSE" else 3))
    return df


def _get_df() -> pd.DataFrame | None:
    path = _master_path()
    if not path or not os.path.isfile(path):
        return None
    mtime = os.path.getmtime(path)
    with _lock:
        if _cache["path"] == path and _cache["mtime"] == mtime and _cache["df"] is not None:
            return _cache["df"]
        df = _load_df(path)
        _cache.update(path=path, mtime=mtime, df=df)
        return df


def list_instruments() -> list[dict]:
    """Distinct instrument types present in the master, with counts (busiest first)."""
    df = _get_df()
    if df is None:
        return []
    counts = df["SEM_INSTRUMENT_NAME"].value_counts()
    out = []
    for value, count in counts.items():
        v = str(value).strip()
        if not v or v in ("NAN", "NONE"):
            continue
        out.append({"value": v, "label": INSTRUMENT_LABELS.get(v, v.title()), "count": int(count)})
    return out


def search_master(q: str, instrument: str | None = None, limit: int = 20) -> list[dict]:
    df = _get_df()
    if df is None:
        return []
    # Default to EQUITY when no instrument is given (keeps the mapping gate behaviour).
    inst = (instrument or "EQUITY").upper().strip()
    df = df[df["SEM_INSTRUMENT_NAME"] == inst]
    qn = _norm(q)
    if not qn or df.empty:
        return []
    mask = (
        df["__symN"].str.contains(qn, na=False, regex=False)
        | df["__custN"].str.contains(qn, na=False, regex=False)
        | df["__nameN"].str.contains(qn, na=False, regex=False)
    )
    hits = df[mask].copy()
    if hits.empty:
        return []
    hits["__rank"] = [0 if str(v).startswith(qn) else 1 for v in hits["__symN"]]
    hits = hits.sort_values(["__rank", "__prio", "SEM_TRADING_SYMBOL"]).head(int(limit))
    return [{
        "symbol": r["SEM_TRADING_SYMBOL"],
        "short_name": r["SEM_CUSTOM_SYMBOL"],
        "listed_name": r["SM_SYMBOL_NAME"],
        "security_id": str(r["SEM_SMST_SECURITY_ID"]).split(".")[0],
        "exchange": r["SEM_EXM_EXCH_ID"],
        "instrument": r["SEM_INSTRUMENT_NAME"],
    } for _, r in hits.iterrows()]
