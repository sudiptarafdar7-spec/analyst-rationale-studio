"""Config schema for the Deepgram transcriber (Step 1)."""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step01_transcribe"

DEFAULT_CONFIG = {
    "model": "nova-3",
    "language": "multi",          # 'hi' | 'multi' | 'detect' | <lang>
    "smart_format": True,
    "diarize": True,
    "punctuate": True,
    "paragraphs": True,
    "utterances": False,
    "numerals": False,
    "filler_words": False,
    "profanity_filter": False,
    "keyterms": [],
    "request_timeout_seconds": 600,
}

# Deepgram engine is fixed (not admin-selectable); no model dropdown here.
CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
