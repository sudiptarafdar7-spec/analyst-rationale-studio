"""Scrip Master File validation (docs/06 §7).

Validates that an uploaded CSV has the columns the Step-7 matcher needs and
reports row count + EQUITY count. Pure-stdlib (csv) so it stays dependency-light.
"""
from __future__ import annotations

import csv
import io

# Required columns the master-file matcher (Step 7) depends on.
REQUIRED_COLUMNS = [
    "SEM_TRADING_SYMBOL",
    "SEM_CUSTOM_SYMBOL",
    "SM_SYMBOL_NAME",
    "SEM_SMST_SECURITY_ID",
    "SEM_EXM_EXCH_ID",
    "SEM_INSTRUMENT_NAME",
]


def validate_master_csv(content: bytes) -> dict:
    """Return {missing_columns, headers, row_count, equity_count, columns_ok}."""
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    headers = reader.fieldnames or []
    missing = [c for c in REQUIRED_COLUMNS if c not in headers]

    row_count = 0
    equity_count = 0
    if not missing:
        for row in reader:
            row_count += 1
            if (row.get("SEM_INSTRUMENT_NAME") or "").strip().upper() == "EQUITY":
                equity_count += 1

    return {
        "missing_columns": missing,
        "headers": headers,
        "row_count": row_count,
        "equity_count": equity_count,
        "columns_ok": not missing,
    }
