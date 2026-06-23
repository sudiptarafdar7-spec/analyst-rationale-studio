"""Tool config registry for the admin "Manage AI Models" screen.

The admin only chooses a provider + model and (optionally) edits the system
prompt. All model-dependent numeric tuning (temperature, max output tokens,
chunk size, overlap, inter-chunk sleep) lives in Python — NUMERIC_DEFAULTS —
because the right values differ per model and are decided in code. Phase-4
pipeline tools read the full effective config via get_effective_config:
DEFAULT_CONFIG (NUMERIC_DEFAULTS + system prompt) ⊕ tool_configs row ⊕ overrides.
"""
from __future__ import annotations

from db.enums import AiTask

# AI providers whose engines are selectable (transcribe is Deepgram-only).
AI_PROVIDERS = ["openai", "anthropic", "gemini"]

# Which pipeline tool backs each selectable task.
TASK_TOOL: dict[str, str] = {
    AiTask.translate.value: "translator",
    AiTask.speaker_detect.value: "speaker_detector",
    AiTask.extract.value: "extract_stocks_analysis",
    AiTask.polish.value: "polish",
}

# Python-side numeric defaults consumed by the pipeline tools. NOT admin-editable
# (they are model-dependent and managed in code / per model in Phase 4).
NUMERIC_DEFAULTS: dict[str, dict] = {
    "translator": {"temperature": 0.0, "max_output_tokens": 8192, "chunk_chars": 6000},
    "speaker_detector": {"temperature": 0.0, "max_output_tokens": 8192, "chunk_chars": 6000},
    "extract_stocks_analysis": {
        "temperature": 0.0,
        "max_output_tokens": 8192,
        "chunk_chars": 6000,
        "overlap_lines": 8,
        "inter_chunk_sleep_secs": 2,
    },
    "polish": {"temperature": 0.0, "max_output_tokens": 8192, "chunk_chars": 6000},
}

# Default system prompt per tool (admin-editable).
SYSTEM_PROMPTS: dict[str, str] = {
    "translator": (
        "Translate the following transcript to English faithfully. Preserve every "
        "[Speaker N] [HH:MM:SS - HH:MM:SS] prefix exactly. Do not summarise, omit, or "
        "reorder anything. Keep spoken numbers as-is (digit conversion happens later)."
    ),
    "speaker_detector": (
        "Re-label each utterance with the speaker's role and name. Mark the target "
        "analyst as Analyst (<target>). The host asks about stocks; other analysts are "
        "from different firms. Detect refusals. Output the speaker-labelled transcript."
    ),
    "extract_stocks_analysis": (
        "Extract ONLY the target analyst's stock calls in strict pairs:\n\nSTOCK NAME\n"
        "analysis text...\n\nNEXT STOCK\nanalysis text...\n\nWhen the host names a stock and "
        "the target analyst answers without naming it, attach that stock name. Group all "
        "of the analyst's aliases to one speaker. Ignore other analysts."
    ),
    "polish": (
        "Professionalise each stock's analysis. Start with \"For {stock}, …\". Use the ₹ "
        "symbol, convert spoken numbers to digits, write at least 100 words, no first "
        "person, no speaker names. NEVER change numeric levels. When multiple stocks are "
        "mentioned, keep only the current stock's levels."
    ),
}

_TASK_LABELS = {
    "translator": "Translate → English",
    "speaker_detector": "Detect Speakers",
    "extract_stocks_analysis": "Extract Analysis",
    "polish": "Polish Analysis",
}


def _editable_fields(tool: str) -> list[dict]:
    # Nothing is admin-editable: the system prompt and all numeric tuning live in
    # Python (SYSTEM_PROMPTS / NUMERIC_DEFAULTS). The admin only selects the model.
    return []


TOOL_SCHEMAS: dict[str, dict] = {
    tool: {
        "label": _TASK_LABELS[tool],
        "task": next(t for t, x in TASK_TOOL.items() if x == tool),
        "fields": _editable_fields(tool),
    }
    for tool in TASK_TOOL.values()
}


def default_config(tool: str) -> dict:
    """Full config the pipeline tools consume: numeric defaults + system prompt."""
    return {**NUMERIC_DEFAULTS.get(tool, {}), "system_prompt": SYSTEM_PROMPTS[tool]}


def get_effective_config(tool: str, db_config: dict | None = None, overrides: dict | None = None) -> dict:
    """DEFAULT_CONFIG ⊕ tool_configs row ⊕ overrides (docs/06 §1)."""
    cfg = default_config(tool)
    if db_config:
        cfg.update({k: v for k, v in db_config.items() if k in cfg})
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if k in cfg and v is not None})
    return cfg


def is_known_tool(tool: str) -> bool:
    return tool in TOOL_SCHEMAS


# Curated, pre-loaded model options per provider (admin can still type a custom
# value in the UI). Values are the API model identifiers; labels are friendly.
MODEL_CATALOG: dict[str, list[dict]] = {
    "openai": [
        {"value": "gpt-4o", "label": "GPT-4o"},
        {"value": "gpt-4o-mini", "label": "GPT-4o mini"},
        {"value": "gpt-4.1", "label": "GPT-4.1"},
        {"value": "gpt-4.1-mini", "label": "GPT-4.1 mini"},
        {"value": "gpt-4-turbo", "label": "GPT-4 Turbo"},
        {"value": "o3", "label": "o3 (reasoning)"},
        {"value": "o4-mini", "label": "o4-mini (reasoning)"},
    ],
    "anthropic": [
        {"value": "claude-opus-4-8", "label": "Claude Opus 4.8"},
        {"value": "claude-sonnet-4-6", "label": "Claude Sonnet 4.6"},
        {"value": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5"},
        {"value": "claude-3-7-sonnet-latest", "label": "Claude 3.7 Sonnet"},
        {"value": "claude-3-5-haiku-latest", "label": "Claude 3.5 Haiku"},
    ],
    "gemini": [
        {"value": "gemini-2.5-pro", "label": "Gemini 2.5 Pro"},
        {"value": "gemini-2.5-flash", "label": "Gemini 2.5 Flash"},
        {"value": "gemini-2.0-flash", "label": "Gemini 2.0 Flash"},
        {"value": "gemini-1.5-pro", "label": "Gemini 1.5 Pro"},
        {"value": "gemini-1.5-flash", "label": "Gemini 1.5 Flash"},
    ],
}
