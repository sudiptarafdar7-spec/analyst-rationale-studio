"""Runtime for Step 11 — Watchlist Extract (via ai_router).

A single, strict transformation: analysis text -> standardised recommendation.
The output shape is IDENTICAL for every stock so the watchlist can render and
compute uniformly. We never trust the model blindly — every field is coerced
and validated in Python, with a deterministic fallback parser for the holding
period and numeric cleaning for all prices.
"""
from __future__ import annotations

import json
import re

from services import ai_router
from tools.step11_watchlist_extract.schema import get_effective_config

TASK = "watchlist"

CALL_TYPES = {"buy", "hold", "sell", "no_view"}

# Strict, empty-but-typed result so callers always get the same keys.
EMPTY: dict = {
    "call_type": "no_view",
    "targets": [],
    "stoploss": None,
    "downfall_target": None,
    "holding_period": None,
    "holding_period_days": None,
}


def _num(v) -> float | None:
    """Clean a single numeric value: strips ₹, commas, '+', spaces; first number."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d+(?:\.\d+)?", str(v).replace(",", ""))
    return float(m.group(0)) if m else None


def _num_list(v) -> list[float]:
    out: list[float] = []
    if isinstance(v, (list, tuple)):
        for x in v:
            n = _num(x)
            if n is not None:
                out.append(n)
    elif v is not None:
        # tolerate "1475 / 1520" or "1475, 1520"
        for tok in re.split(r"[/,;]| and ", str(v)):
            n = _num(tok)
            if n is not None:
                out.append(n)
    # de-dup preserving order
    seen: set[float] = set()
    uniq = []
    for n in out:
        if n not in seen:
            seen.add(n)
            uniq.append(n)
    return uniq


_PERIOD_UNITS = [
    (r"intraday|same day|today|btst", 1),
    (r"year", 365),
    (r"month", 30),
    (r"week", 7),
    (r"day", 1),
]


def period_to_days(text: str | None) -> int | None:
    """Best-effort '2 months' / '1-2 weeks' / 'intraday' -> integer days."""
    if not text:
        return None
    t = str(text).lower()
    if re.search(r"intraday|same day|btst", t):
        return 1
    nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", t)]
    n = max(nums) if nums else 1.0  # use the upper bound of a range
    for pat, mult in _PERIOD_UNITS:
        if re.search(pat, t):
            return int(round(n * mult))
    return None


def _normalise(data: dict) -> dict:
    out = dict(EMPTY)
    ct = str(data.get("call_type", "")).strip().lower().replace(" ", "_")
    if ct in {"no view", "noview", "neutral", "avoid", "wait"}:
        ct = "no_view"
    out["call_type"] = ct if ct in CALL_TYPES else "no_view"
    out["targets"] = _num_list(data.get("targets"))
    out["stoploss"] = _num(data.get("stoploss"))
    out["downfall_target"] = _num(data.get("downfall_target"))
    hp = data.get("holding_period")
    out["holding_period"] = (str(hp).strip() or None) if hp else None
    hpd = data.get("holding_period_days")
    out["holding_period_days"] = int(hpd) if isinstance(hpd, (int, float)) and hpd else period_to_days(out["holding_period"])
    return out


def extract_call(analysis: str, stock_name: str = "", overrides: dict | None = None) -> dict:
    """Return a strict standardised recommendation dict (always the same keys).

    Adds a private "_raw" with the raw model text for audit. Falls back to a
    typed no_view result on any error so the watchlist build never crashes.
    """
    analysis = (analysis or "").strip()
    if not analysis:
        return {**EMPTY, "_raw": ""}

    cfg = get_effective_config(overrides)
    system = cfg.get("system_prompt", "")
    user = f"STOCK: {stock_name or 'Unknown'}\nANALYSIS:\n{analysis}\n\nReturn the JSON object now."
    try:
        raw = ai_router.chat_for_task(TASK, system, user, cfg)
    except Exception as exc:  # noqa: BLE001
        return {**EMPTY, "_raw": f"error: {exc}"}

    m = re.search(r"\{.*\}", raw or "", re.DOTALL)
    if not m:
        return {**EMPTY, "_raw": raw}
    try:
        data = json.loads(m.group(0))
    except Exception:
        return {**EMPTY, "_raw": raw}

    result = _normalise(data if isinstance(data, dict) else {})
    result["_raw"] = raw
    return result
