"""Runtime for Step 2 — Translate to English (via ai_router).

Ported from the reference translator. Long inputs split on natural paragraph /
sentence boundaries; empty responses halve-and-retry. The chunk size default is
large so a typical transcript is one call (lower cost).
"""
from __future__ import annotations

import os
import re
import time

from services import ai_router
from tools.step02_translate.schema import get_effective_config
from utils.language_detect import is_english

TASK = "translate"
MIN_CHUNK_CHARS = 1_500
MAX_EMPTY_RETRIES = 2
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[।.?!])\s+")


def _split_paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n", text)
    return [p for p in (s.strip("\n") for s in parts) if p.strip()]


def _split_sentences(paragraph: str) -> list[str]:
    return [p for p in _SENTENCE_SPLIT_RE.split(paragraph) if p.strip()]


def _hard_split(piece: str, size: int) -> list[str]:
    out: list[str] = []
    while len(piece) > size:
        cut = piece.rfind(" ", 0, size)
        if cut <= 0:
            cut = size
        out.append(piece[:cut])
        piece = piece[cut:].lstrip()
    if piece:
        out.append(piece)
    return out


def _chunk_text(text: str, target_size: int) -> list[str]:
    if len(text) <= target_size:
        return [text]
    chunks: list[str] = []
    buf = ""

    def flush():
        nonlocal buf
        if buf.strip():
            chunks.append(buf.rstrip())
        buf = ""

    for para in _split_paragraphs(text):
        if len(para) <= target_size:
            if len(buf) + len(para) + 2 > target_size and buf:
                flush()
            buf += (("\n\n" if buf else "") + para)
            continue
        flush()
        sent_buf = ""
        for sent in _split_sentences(para):
            if len(sent) > target_size:
                if sent_buf.strip():
                    chunks.append(sent_buf.rstrip()); sent_buf = ""
                for piece in _hard_split(sent, target_size):
                    chunks.append(piece)
                continue
            if len(sent_buf) + len(sent) + 1 > target_size and sent_buf:
                chunks.append(sent_buf.rstrip()); sent_buf = ""
            sent_buf += ((" " if sent_buf else "") + sent)
        if sent_buf.strip():
            chunks.append(sent_buf.rstrip())
    flush()
    return chunks


def _chat(provider, model, system, user, max_tokens, temperature) -> tuple[str, str | None]:
    try:
        return ai_router.chat(provider, model, system, user, max_tokens, temperature), None
    except Exception as exc:
        return "", str(exc)


def _translate_with_retry(provider, model, system, text, max_tokens, temperature, depth=0):
    out, err = _chat(provider, model, system, text, max_tokens, temperature)
    if err:
        return "", err
    if out:
        return out, None
    if depth >= MAX_EMPTY_RETRIES or len(text) <= MIN_CHUNK_CHARS:
        return text, None  # keep source verbatim rather than lose context
    sub = _chunk_text(text, max(MIN_CHUNK_CHARS, len(text) // 2))
    if len(sub) < 2:
        return text, None
    parts = []
    for s in sub:
        o, e = _translate_with_retry(provider, model, system, s, max_tokens, temperature, depth + 1)
        if e:
            return "", e
        parts.append(o)
    return "\n\n".join(p for p in parts if p), None


def translate_text(text: str, overrides: dict | None = None) -> dict:
    text = text or ""
    if not text.strip():
        return {"success": False, "text": "", "skipped": False, "error": "Input text is empty"}

    cfg = get_effective_config(overrides)
    if bool(cfg.get("skip_if_english", True)) and is_english(text):
        print("🇬🇧 [step02_translate] Already English — skipping (no API cost).")
        return {"success": True, "text": text, "skipped": True, "error": None}

    provider, model = ai_router.resolve_model(TASK, cfg.get("model"))
    system = cfg.get("system_prompt") or ""
    max_tokens = int(cfg.get("max_output_tokens", 16384))
    temperature = float(cfg.get("temperature", 0.1))
    chunk_chars = max(MIN_CHUNK_CHARS, int(cfg.get("chunk_chars", 40000)))

    chunks = _chunk_text(text, chunk_chars)
    print(f"🌐 [step02_translate] {provider}/{model} — {len(chunks)} chunk(s)")
    parts: list[str] = []
    for i, chunk in enumerate(chunks, 1):
        out, err = _translate_with_retry(provider, model, system, chunk, max_tokens, temperature)
        if err:
            return {"success": False, "text": "", "skipped": False, "error": err}
        parts.append(out)
        if len(chunks) > 1 and i < len(chunks):
            time.sleep(0.3)
    return {"success": True, "text": "\n\n".join(p for p in parts if p).strip(), "skipped": False, "error": None}


def run(text: str | None = None, *, job_folder: str | None = None, overrides: dict | None = None,
        input_filename: str = "bulk-input.txt", output_filename: str = "bulk-input-english.txt") -> dict:
    if text is not None:
        return translate_text(text, overrides=overrides)
    if not job_folder:
        return {"success": False, "error": "Either `text` or `job_folder` is required."}
    input_file = os.path.join(job_folder, input_filename)
    output_file = os.path.join(job_folder, output_filename)
    if not os.path.exists(input_file):
        return {"success": False, "error": f"Input file not found: {input_file}"}
    with open(input_file, "r", encoding="utf-8") as f:
        result = translate_text(f.read(), overrides=overrides)
    if not result["success"]:
        return {"success": False, "error": result.get("error") or "Translation failed"}
    os.makedirs(os.path.dirname(output_file) or ".", exist_ok=True)
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(result["text"])
    return {"success": True, "output_file": output_file, "text": result["text"], "skipped": result.get("skipped", False)}
