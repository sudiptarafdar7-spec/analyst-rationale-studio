"""Config schema for Step 7 — Map Master File (deterministic; no options)."""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step07_map_master"
DEFAULT_CONFIG: dict = {}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
