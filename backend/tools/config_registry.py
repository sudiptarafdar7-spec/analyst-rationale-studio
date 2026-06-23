"""Tool config registry for the admin "Manage AI Models" screen.

The admin only chooses a provider + model. System prompts and all numeric tuning
live in Python (SYSTEM_PROMPTS / NUMERIC_DEFAULTS). Tools read their full
effective config via get_effective_config: DEFAULT_CONFIG ⊕ tool_configs ⊕ overrides.

Chunk sizes are large on purpose: modern models have big context windows, so a
typical show transcript goes through in ONE call — fewer calls = lower cost.
"""
from __future__ import annotations

from db.enums import AiTask

AI_PROVIDERS = ["openai", "anthropic", "gemini"]

# Each selectable task -> its step-numbered pipeline tool.
TASK_TOOL: dict[str, str] = {
    AiTask.translate.value: "step02_translate",
    AiTask.speaker_detect.value: "step03_detect_speakers",
    AiTask.extract.value: "step04_extract_analysis",
    AiTask.polish.value: "step06_polish",
}

# Python-side numeric defaults consumed by the tools (not admin-editable).
# Big chunk_chars => single-call for typical inputs => fewer tokens billed.
NUMERIC_DEFAULTS: dict[str, dict] = {
    "step02_translate": {
        "temperature": 0.1,
        "max_output_tokens": 16384,
        "chunk_chars": 40000,
        "skip_if_english": True,
    },
    "step03_detect_speakers": {
        "temperature": 0.0,
        "max_output_tokens": 16384,
        "chunk_chars": 40000,
    },
    "step04_extract_analysis": {
        "temperature": 0.0,
        "max_output_tokens": 8192,
        "chunk_chars": 40000,
        "overlap_lines": 6,
        "inter_chunk_sleep_secs": 1,
    },
    "step06_polish": {
        "temperature": 0.3,
        "max_output_tokens": 8192,
        "batch_size": 12,  # polish this many stocks per API call (1 call for ≤12)
    },
}

SYSTEM_PROMPTS: dict[str, str] = {
    "step02_translate": (
        "Translate the following transcript to English faithfully. Preserve every "
        "[Speaker N] [HH:MM:SS - HH:MM:SS] prefix exactly. Do not summarise, omit, or "
        "reorder anything. Keep spoken numbers as-is (digit conversion happens later). "
        "Return only the translated transcript."
    ),
    "step03_detect_speakers": (
        "Re-label each utterance in this diarized transcript with the speaker's role and "
        "name. The host asks about stocks one by one; 4-5 analysts from different firms "
        "answer. Keep the [HH:MM:SS - HH:MM:SS] timestamps. Output the speaker-labelled "
        "transcript only — do not summarise or drop lines."
    ),
    "step04_extract_analysis": (
        "Extract ONLY the target analyst's stock calls in strict pairs:\n\nSTOCK NAME\n"
        "analysis text...\n\nNEXT STOCK\nanalysis text...\n\nWhen the host names a stock and "
        "the target analyst answers without naming it, attach that stock name. Group all of "
        "the analyst's aliases to one speaker. Ignore every other analyst. Output ONLY the "
        "pairs — no preamble, no commentary, no markdown fences."
    ),
    "step06_polish": (
        "You are a professional financial writer. Polish each stock analysis to be "
        "professional, clear and well-structured. Never change numerical values (targets, "
        "stop-loss, levels) or invent information. Always use ₹ for Indian Rupee prices."
    ),
}

_TASK_LABELS = {
    "step02_translate": "Translate → English",
    "step03_detect_speakers": "Detect Speakers",
    "step04_extract_analysis": "Extract Analysis",
    "step06_polish": "Polish Analysis",
}


def _editable_fields(tool: str) -> list[dict]:
    # Nothing admin-editable: prompts + numerics live in Python.
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
    cfg = dict(NUMERIC_DEFAULTS.get(tool, {}))
    if tool in SYSTEM_PROMPTS:
        cfg["system_prompt"] = SYSTEM_PROMPTS[tool]
    return cfg


def get_effective_config(tool: str, db_config: dict | None = None, overrides: dict | None = None) -> dict:
    cfg = default_config(tool)
    if db_config:
        cfg.update({k: v for k, v in db_config.items() if k in cfg})
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if k in cfg and v is not None})
    return cfg


def is_known_tool(tool: str) -> bool:
    return tool in TOOL_SCHEMAS


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
