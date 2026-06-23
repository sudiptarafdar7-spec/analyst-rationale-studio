"""Normalize OpenAI chat-completion params across model families.

Reasoning models (o1/o3/o4, gpt-5*) reject `temperature` and use
`max_completion_tokens` instead of `max_tokens`. This helper returns the right
kwargs so tool code doesn't special-case models.
"""
from __future__ import annotations

_REASONING_PREFIXES = ("o1", "o3", "o4", "gpt-5")


def is_reasoning_model(model: str) -> bool:
    m = (model or "").lower()
    return m.startswith(_REASONING_PREFIXES)


def chat_completion_kwargs(model: str, max_tokens: int, temperature: float) -> dict:
    """Return provider-correct kwargs for an OpenAI chat completion."""
    if is_reasoning_model(model):
        # Reasoning models: only default temperature is allowed; token cap is
        # passed as max_completion_tokens.
        return {"max_completion_tokens": int(max_tokens)}
    return {"max_tokens": int(max_tokens), "temperature": float(temperature)}
