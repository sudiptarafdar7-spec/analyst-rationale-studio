"""Config schema for Step 9 — Generate Charts (Dhan + mplfinance; no AI options).

Chart look/feel matches the reference premium design. Numeric knobs live here so
they are admin-tunable via tool_configs, but the engine (Dhan) is fixed.
"""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step09_generate_charts"

DEFAULT_CONFIG = {
    "history_months": 8,          # how far back daily candles are pulled
    "ma_periods": [20, 50, 100, 200],
    "rsi_period": 14,
    "inter_request_sleep_secs": 1.5,
    "dpi": 150,
    "figsize": [14, 7],
    "request_timeout_seconds": 30,
    "max_retries": 4,
}

CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
