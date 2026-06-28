"""Loader for the baked default PDF template.

The canonical default lives in `backend/scripts/default_pdf_template.json`,
produced by `python -m scripts.dump_default_template` from a live database.
Both the admin "Reset design" action and the fresh-install seed read it here,
so there is a single source of truth. Missing/invalid file -> None (callers
fall back to their own built-in default).
"""
from __future__ import annotations

import json
import os

_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),  # backend/
    "scripts",
    "default_pdf_template.json",
)


def load_default_pdf_template() -> dict | None:
    try:
        with open(_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (FileNotFoundError, ValueError, OSError):
        return None
    if isinstance(data, dict) and isinstance(data.get("design"), dict) and data["design"]:
        return {
            "company_name": data.get("company_name") or "",
            "registration_details": data.get("registration_details"),
            "design": data["design"],
        }
    return None
