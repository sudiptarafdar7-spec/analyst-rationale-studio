"""Cached scrip-master search for the mapping review gate.

Lets the user look up a stock by symbol or name and auto-fill the mapped fields
(security id, exchange, listed/short name). The master CSV can be large, so it's
loaded once and cached by (path, mtime).
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
    if "SEM_INSTRUMENT_NAME" in df.columns:
        df = df[df["SEM_INSTRUMENT_NAME"].astype(str).str.upper() == "EQUITY"].copy()
    for c in _REQ:
        df[c] = df[c].astype(str) if c in df.columns else ""
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


def search_master(q: str, limit: int = 20) -> list[dict]:
    df = _get_df()
    if df is None:
        return []
    qn = _norm(q)
    if not qn:
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
    out = []
    for _, r in hits.iterrows():
        out.append({
            "symbol": r["SEM_TRADING_SYMBOL"],
            "short_name": r["SEM_CUSTOM_SYMBOL"],
            "listed_name": r["SM_SYMBOL_NAME"],
            "security_id": str(r["SEM_SMST_SECURITY_ID"]).split(".")[0],
            "exchange": r["SEM_EXM_EXCH_ID"],
            "instrument": r["SEM_INSTRUMENT_NAME"],
        })
    return out
