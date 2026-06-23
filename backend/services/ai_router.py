"""Provider-agnostic AI chat layer.

Tools call `ai_router.chat(...)` only — never an SDK directly — so the engine
(OpenAI / Anthropic / Gemini) is admin-selectable per task. Model resolution
honours the ai_models mapping and the model_settings global fallback.
"""
from __future__ import annotations

from sqlalchemy import select

from db.enums import AiTask
from db.models import AiModel, ModelSettings
from db.session import SessionLocal
from tools.config_registry import MODEL_CATALOG
from utils.database import get_api_key
from utils.openai_compat import chat_completion_kwargs

GLOBAL_SENTINEL = "__global__"


class AiRouterError(RuntimeError):
    pass


def _infer_provider(model: str) -> str:
    for provider, opts in MODEL_CATALOG.items():
        if any(o["value"] == model for o in opts):
            return provider
    m = (model or "").lower()
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith("gemini"):
        return "gemini"
    return "openai"  # gpt-*, o-series, and unknowns default to OpenAI


def resolve_model(task: str | AiTask | None, cfg_model: str | None = None) -> tuple[str, str]:
    """Return (provider, model_name) for a task.

    Precedence: explicit cfg_model (non-global) → ai_models row for the task →
    global fallback model. '__global__' anywhere resolves to model_settings.
    """
    task_value = task.value if isinstance(task, AiTask) else task
    with SessionLocal() as db:
        row = db.scalar(select(AiModel).where(AiModel.task == task_value)) if task_value else None
        provider = row.provider.value if row else "openai"
        model = cfg_model or (row.model_name if row else GLOBAL_SENTINEL)

        if not model or model == GLOBAL_SENTINEL:
            settings_row = db.get(ModelSettings, 1)
            model = settings_row.global_model if settings_row else "gpt-4o"
            provider = _infer_provider(model)
        elif cfg_model:
            # A bare model override: infer its provider.
            provider = _infer_provider(model)
    return provider, model


# --- provider clients (lazy SDK imports so module import stays light) -------
def get_client(provider: str):
    key = get_api_key(provider)
    if not key:
        raise AiRouterError(f"No API key configured for provider '{provider}'")
    if provider == "openai":
        from openai import OpenAI

        return OpenAI(api_key=key)
    if provider == "anthropic":
        from anthropic import Anthropic

        return Anthropic(api_key=key)
    if provider == "gemini":
        import google.generativeai as genai

        genai.configure(api_key=key)
        return genai
    raise AiRouterError(f"Unknown provider '{provider}'")


def chat(
    provider: str,
    model: str,
    system: str,
    user: str,
    max_tokens: int = 8192,
    temperature: float = 0.0,
) -> str:
    """Single-turn chat completion, normalised across providers. Returns text."""
    client = get_client(provider)

    if provider == "openai":
        kwargs = chat_completion_kwargs(model, max_tokens, temperature)
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            **kwargs,
        )
        return (resp.choices[0].message.content or "").strip()

    if provider == "anthropic":
        resp = client.messages.create(
            model=model,
            system=system,
            messages=[{"role": "user", "content": user}],
            max_tokens=int(max_tokens),
            temperature=float(temperature),
        )
        parts = [blk.text for blk in resp.content if getattr(blk, "type", None) == "text"]
        return "".join(parts).strip()

    if provider == "gemini":
        genai = client
        model_obj = genai.GenerativeModel(model, system_instruction=system)
        resp = model_obj.generate_content(
            user,
            generation_config={"max_output_tokens": int(max_tokens), "temperature": float(temperature)},
        )
        return (getattr(resp, "text", "") or "").strip()

    raise AiRouterError(f"Unknown provider '{provider}'")


def chat_for_task(task: str | AiTask, system: str, user: str, cfg: dict | None = None) -> str:
    """Convenience: resolve the task's model, then chat. cfg may carry model/
    temperature/max_output_tokens overrides."""
    cfg = cfg or {}
    provider, model = resolve_model(task, cfg.get("model"))
    return chat(
        provider,
        model,
        system,
        user,
        max_tokens=int(cfg.get("max_output_tokens", 8192)),
        temperature=float(cfg.get("temperature", 0.0)),
    )
