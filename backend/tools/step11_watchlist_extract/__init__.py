"""Step 11 — Watchlist Extract.

Turns ONE stock's analysis text into a strict, standardised recommendation
dict for the compliance watchlist. Model is admin-selectable (ai_task
'watchlist'). Public contract:

    extract_call(analysis, stock_name="", overrides=None) -> dict
"""
from .runtime import extract_call  # noqa: F401
