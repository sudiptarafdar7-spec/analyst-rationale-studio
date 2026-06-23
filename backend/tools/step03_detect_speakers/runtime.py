"""Runtime for Step 3 — Detect Speakers (via ai_router).

Ported from the reference speaker_detector. Keeps refusal detection and the
line-respecting chunker, but with a large default chunk so a normal transcript
is a single call (lower cost). The target analyst name is injected so the model
labels that speaker as 'Analyst (<target>)'.
"""
from __future__ import annotations

import re

from services import ai_router
from tools.step03_detect_speakers.schema import get_effective_config

TASK = "speaker_detect"

_REFUSAL_MARKERS = (
    "i'm sorry", "i am sorry", "i cannot", "i can't", "i can not",
    "unable to assist", "unable to help", "as an ai", "i won't",
    "i will not", "cannot assist", "can't assist",
)


def _looks_like_refusal(text: str) -> bool:
    if not text:
        return True
    stripped = text.strip()
    if len(stripped) >= 400:
        return False
    head = stripped.lower()[:80]
    return any(head.startswith(m) or f". {m}" in head[:80] for m in _REFUSAL_MARKERS)


def _split_for_chunks(text: str, max_chars: int) -> list[str]:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return [text]
    lines = text.split("\n")
    chunks, buf, buf_len = [], [], 0
    for ln in lines:
        if buf_len + len(ln) + 1 > max_chars and buf:
            chunks.append("\n".join(buf).strip()); buf, buf_len = [], 0
        if len(ln) > max_chars:
            for sent in re.split(r"(?<=[.।!?])\s+", ln):
                if buf_len + len(sent) + 1 > max_chars and buf:
                    chunks.append("\n".join(buf).strip()); buf, buf_len = [], 0
                buf.append(sent); buf_len += len(sent) + 1
        else:
            buf.append(ln); buf_len += len(ln) + 1
    if buf:
        chunks.append("\n".join(buf).strip())
    return [c for c in chunks if c]


def detect_speakers(text: str, overrides: dict | None = None) -> dict:
    text = text or ""
    if not text.strip():
        return {"success": False, "text": "", "error": "Input text is empty"}

    cfg = get_effective_config(overrides)
    provider, model = ai_router.resolve_model(TASK, cfg.get("model"))
    target = (cfg.get("target_analyst_name") or "").strip()
    base_prompt = cfg.get("system_prompt") or ""
    system_prompt = (
        (f"PRIMARY ANALYST TO IDENTIFY: {target}\nAlways label that speaker as "
         f"'Analyst ({target})' in the output.\n\n" if target else "")
        + base_prompt
    )
    max_tokens = int(cfg.get("max_output_tokens", 16384))
    temperature = float(cfg.get("temperature", 0.0))
    chunk_chars = int(cfg.get("chunk_chars", 40000))

    chunks = _split_for_chunks(text, chunk_chars)
    print(f"🎤 [step03_detect_speakers] {provider}/{model} — {len(chunks)} chunk(s)")
    parts: list[str] = []
    for i, chunk in enumerate(chunks, 1):
        try:
            out = ai_router.chat(provider, model, system_prompt, chunk, max_tokens, temperature)
        except Exception as exc:
            return {"success": False, "text": "", "error": str(exc)}
        if _looks_like_refusal(out):
            return {"success": False, "text": "",
                    "error": f"Speaker-detect model refused on chunk {i}/{len(chunks)}. Raw: {out[:200]}"}
        parts.append(out)

    relabeled = "\n\n".join(p for p in parts if p).strip()
    return {"success": True, "text": relabeled, "error": None}


def run(text: str, overrides: dict | None = None) -> dict:
    return detect_speakers(text, overrides=overrides)
