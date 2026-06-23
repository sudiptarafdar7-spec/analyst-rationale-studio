"""Config schema for Step 4 — Extract Analysis."""
from __future__ import annotations

from tools._schema_base import effective
from tools.config_registry import default_config as _reg_default

TOOL_NAME = "step04_extract_analysis"

DEFAULT_CONFIG = {
    "model": "__global__",
    "target_analyst_name": "",   # from the job's selected analyst
    "aliases": "",               # comma-separated, from the analyst
    **_reg_default(TOOL_NAME),
}
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def parse_aliases(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        items = str(raw).split(",")
    return [a.strip() for a in items if a and a.strip()]


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
