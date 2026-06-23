"""Config schema for Step 5 — Convert to CSV (deterministic; no options)."""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step05_convert_csv"
DEFAULT_CONFIG: dict = {}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
