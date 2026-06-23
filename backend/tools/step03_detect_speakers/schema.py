"""Config schema for Step 3 — Detect Speakers."""
from __future__ import annotations

from tools._schema_base import effective
from tools.config_registry import default_config as _reg_default

TOOL_NAME = "step03_detect_speakers"

DEFAULT_CONFIG = {
    "model": "__global__",
    "target_analyst_name": "",  # filled per-job from the selected analyst
    **_reg_default(TOOL_NAME),
}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
