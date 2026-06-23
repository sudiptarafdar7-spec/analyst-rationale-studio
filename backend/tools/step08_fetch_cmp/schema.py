"""Config schema for Step 8 — Fetch CMP (Dhan; no AI options)."""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step08_fetch_cmp"
DEFAULT_CONFIG = {"inter_request_sleep_secs": 0.5}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
