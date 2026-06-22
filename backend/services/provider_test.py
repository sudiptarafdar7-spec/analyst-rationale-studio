"""Live connectivity checks for each external provider.

Each check makes a cheap authenticated request and maps the result to
(ok, human-readable message). Network/credential errors are caught and returned
as ok=False rather than raising.
"""
from __future__ import annotations

import httpx

from db.enums import ApiProvider

_TIMEOUT = 12.0


def _result(ok: bool, message: str) -> tuple[bool, str]:
    return ok, message


def _check_openai(key: str) -> tuple[bool, str]:
    r = httpx.get(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {key}"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to OpenAI")
    if r.status_code in (401, 403):
        return _result(False, "OpenAI rejected the key (unauthorized)")
    return _result(False, f"OpenAI returned HTTP {r.status_code}")


def _check_anthropic(key: str) -> tuple[bool, str]:
    r = httpx.get(
        "https://api.anthropic.com/v1/models",
        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to Anthropic")
    if r.status_code in (401, 403):
        return _result(False, "Anthropic rejected the key (unauthorized)")
    return _result(False, f"Anthropic returned HTTP {r.status_code}")


def _check_gemini(key: str) -> tuple[bool, str]:
    r = httpx.get(
        "https://generativelanguage.googleapis.com/v1beta/models",
        params={"key": key},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to Gemini")
    if r.status_code in (400, 401, 403):
        return _result(False, "Gemini rejected the key (unauthorized)")
    return _result(False, f"Gemini returned HTTP {r.status_code}")


def _check_deepgram(key: str) -> tuple[bool, str]:
    r = httpx.get(
        "https://api.deepgram.com/v1/projects",
        headers={"Authorization": f"Token {key}"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to Deepgram")
    if r.status_code in (401, 403):
        return _result(False, "Deepgram rejected the key (unauthorized)")
    return _result(False, f"Deepgram returned HTTP {r.status_code}")


def _check_youtube(key: str) -> tuple[bool, str]:
    r = httpx.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={"part": "id", "id": "dQw4w9WgXcQ", "key": key},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to YouTube Data API")
    if r.status_code in (400, 401, 403):
        return _result(False, "YouTube rejected the key (unauthorized or disabled)")
    return _result(False, f"YouTube returned HTTP {r.status_code}")


def _check_dhan(key: str) -> tuple[bool, str]:
    # Dhan uses the `access-token` header. /v2/fundlimit is a light authed call.
    r = httpx.get(
        "https://api.dhan.co/v2/fundlimit",
        headers={"access-token": key, "Accept": "application/json"},
        timeout=_TIMEOUT,
    )
    if r.status_code == 200:
        return _result(True, "Connected to Dhan")
    if r.status_code in (401, 403):
        return _result(False, "Dhan rejected the token (unauthorized)")
    return _result(False, f"Dhan returned HTTP {r.status_code}")


_CHECKS = {
    ApiProvider.openai: _check_openai,
    ApiProvider.anthropic: _check_anthropic,
    ApiProvider.gemini: _check_gemini,
    ApiProvider.deepgram: _check_deepgram,
    ApiProvider.youtube: _check_youtube,
    ApiProvider.dhan: _check_dhan,
}


def test_provider(provider: ApiProvider, key: str) -> tuple[bool, str]:
    check = _CHECKS.get(provider)
    if check is None:
        return _result(False, f"No connectivity test for {provider.value}")
    try:
        return check(key)
    except httpx.TimeoutException:
        return _result(False, "Connection timed out")
    except httpx.HTTPError as exc:
        return _result(False, f"Connection error: {exc}")
    except Exception as exc:  # never let a connectivity probe crash the request
        return _result(False, f"Test failed: {exc}")
