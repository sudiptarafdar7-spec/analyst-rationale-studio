"""Config schema for Step 2 — Translate."""
from __future__ import annotations

from tools._schema_base import effective
from tools.config_registry import default_config as _reg_default

TOOL_NAME = "step02_translate"

DEFAULT_CONFIG = {"model": "__global__", **_reg_default(TOOL_NAME)}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
