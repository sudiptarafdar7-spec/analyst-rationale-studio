"""Tool config registry for the admin "Manage AI Models" screen.

Each selectable AI task maps to a pipeline tool. Every tool exposes a
DEFAULT_CONFIG and a CONFIG_JSON_SCHEMA (field descriptors the admin UI renders
a form from). The Phase-4 pipeline tools will read their effective config from
here (DEFAULT_CONFIG ⊕ tool_configs DB row ⊕ per-job overrides), per docs/06 §1.
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


def _common_fields(system_prompt: str) -> list[dict]:
    return [
        {
            "name": "temperature",
            "label": "Temperature",
            "type": "number",
            "default": 0.0,
            "min": 0,
            "max": 2,
            "step": 0.1,
            "help": "Lower = more deterministic. 0 is best for extraction tasks.",
        },
        {
            "name": "max_output_tokens",
            "label": "Max output tokens",
            "type": "number",
            "default": 8192,
            "min": 256,
            "max": 32000,
            "step": 256,
            "help": "Upper bound on the model's response length.",
        },
        {
            "name": "chunk_chars",
            "label": "Chunk size (characters)",
            "type": "number",
            "default": 6000,
            "min": 1000,
            "max": 40000,
            "step": 500,
            "help": "Transcript is split into chunks of this size before sending to the model.",
        },
        {
            "name": "system_prompt",
            "label": "System prompt",
            "type": "textarea",
            "default": system_prompt,
            "rows": 12,
            "help": "Instructions sent to the model for this task.",
        },
    ]


# --- Per-tool schemas -------------------------------------------------------
TOOL_SCHEMAS: dict[str, dict] = {
    "translator": {
        "label": "Translate → English",
        "task": AiTask.translate.value,
        "fields": _common_fields(
            "Translate the following transcript to English faithfully. Preserve every "
            "[Speaker N] [HH:MM:SS - HH:MM:SS] prefix exactly. Do not summarise, omit, or "
            "reorder anything. Keep spoken numbers as-is (digit conversion happens later)."
        ),
    },
    "speaker_detector": {
        "label": "Detect Speakers",
        "task": AiTask.speaker_detect.value,
        "fields": _common_fields(
            "Re-label each utterance with the speaker's role and name. Mark the target "
            "analyst as Analyst (<target>). The host asks about stocks; other analysts are "
            "from different firms. Detect refusals. Output the speaker-labelled transcript."
        )
        + [
            {
                "name": "target_analyst_name",
                "label": "Default target analyst",
                "type": "text",
                "default": "",
                "help": "Usually filled per-job from the selected analyst; this is a fallback.",
            },
        ],
    },
    "extract_stocks_analysis": {
        "label": "Extract Analysis",
        "task": AiTask.extract.value,
        "fields": _common_fields(
            "Extract ONLY the target analyst's stock calls in strict pairs:\n\nSTOCK NAME\n"
            "analysis text...\n\nNEXT STOCK\nanalysis text...\n\nWhen the host names a stock and "
            "the target analyst answers without naming it, attach that stock name. Group all "
            "of the analyst's aliases to one speaker. Ignore other analysts."
        )
        + [
            {
                "name": "overlap_lines",
                "label": "Chunk overlap (lines)",
                "type": "number",
                "default": 8,
                "min": 0,
                "max": 50,
                "step": 1,
                "help": "Lines repeated between chunks so calls spanning a boundary aren't lost.",
            },
            {
                "name": "inter_chunk_sleep_secs",
                "label": "Sleep between chunks (s)",
                "type": "number",
                "default": 2,
                "min": 0,
                "max": 60,
                "step": 1,
                "help": "Pause between chunk requests to respect provider rate limits.",
            },
        ],
    },
    "polish": {
        "label": "Polish Analysis",
        "task": AiTask.polish.value,
        "fields": _common_fields(
            "Professionalise each stock's analysis. Start with \"For {stock}, …\". Use the ₹ "
            "symbol, convert spoken numbers to digits, write at least 100 words, no first "
            "person, no speaker names. NEVER change numeric levels. When multiple stocks are "
            "mentioned, keep only the current stock's levels."
        ),
    },
}


def default_config(tool: str) -> dict:
    fields = TOOL_SCHEMAS[tool]["fields"]
    return {f["name"]: f["default"] for f in fields}


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
