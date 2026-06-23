"""Check that a selected provider + model is reachable with the stored API key.

Uses each provider's "retrieve model" endpoint — a cheap, no-generation call
that confirms both the key and the model id are valid/available.
"""
from __future__ import annotations

import httpx

_TIMEOUT = 12.0


def _result(ok: bool, message: str) -> tuple[bool, str]:
    return ok, message


def _check_openai(model: str, key: str) -> tuple[bool, str]:
    r = httpx.get(
        f"https://api.openai.com/v1/models/{model}",
        headers={"Authorization": f"Bearer {key}"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, f"OpenAI model '{model}' is available")
    if r.status_code == 404:
        return _result(False, f"OpenAI has no model '{model}' for this key")
    if r.status_code in (401, 403):
        return _result(False, "OpenAI rejected the key (unauthorized)")
    return _result(False, f"OpenAI returned HTTP {r.status_code}")


def _check_anthropic(model: str, key: str) -> tuple[bool, str]:
    r = httpx.get(
        f"https://api.anthropic.com/v1/models/{model}",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, f"Anthropic model '{model}' is available")
    if r.status_code == 404:
        return _result(False, f"Anthropic has no model '{model}'")
    if r.status_code in (401, 403):
        return _result(False, "Anthropic rejected the key (unauthorized)")
    return _result(False, f"Anthropic returned HTTP {r.status_code}")


def _check_gemini(model: str, key: str) -> tuple[bool, str]:
    r = httpx.get(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}",
        params={"key": key},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, f"Gemini model '{model}' is available")
    if r.status_code in (404, 400):
        return _result(False, f"Gemini has no model '{model}' (or it's not enabled)")
    if r.status_code in (401, 403):
        return _result(False, "Gemini rejected the key (unauthorized)")
    return _result(False, f"Gemini returned HTTP {r.status_code}")


_CHECKS = {
    "openai": _check_openai,
    "anthropic": _check_anthropic,
    "gemini": _check_gemini,
}


def test_model(provider: str, model: str, key: str) -> tuple[bool, str]:
    check = _CHECKS.get(provider)
    if check is None:
        return _result(False, f"No model test for provider '{provider}'")
    try:
        return check(model, key)
    except httpx.TimeoutException:
        return _result(False, "Connection timed out")
    except Exception as exc:  # never let a probe crash the request
        return _result(False, f"Test failed: {exc}")
