"""Shared helper for each tool's schema.py get_effective_config().

effective = DEFAULT_CONFIG ⊕ tool_configs DB row ⊕ overrides   (docs/06 §1)
"""
from __future__ import annotations

from sqlalchemy import select

from db.models import ToolConfig
from db.session import SessionLocal


def load_tool_config_row(tool_name: str) -> dict:
    try:
        with SessionLocal() as db:
            row = db.scalar(select(ToolConfig).where(ToolConfig.tool == tool_name))
            return dict(row.config) if row and row.config else {}
    except Exception:
        return {}


def effective(default_config: dict, tool_name: str, overrides: dict | None = None) -> dict:
    cfg = dict(default_config)
    cfg.update(load_tool_config_row(tool_name) or {})
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg
