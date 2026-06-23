"""Runtime for Step 4 — Extract Analysis (via ai_router).

Ported from the reference extract tool. Keeps the line-respecting chunker, the
read-only overlap context, and `_normalise_blocks` enforcing the strict
STOCK\\nanalysis output shape. Large default chunk => one call for normal inputs.
"""
from __future__ import annotations

import re
import time

from services import ai_router
from tools.step04_extract_analysis.schema import get_effective_config, parse_aliases

TASK = "extract"

_PREAMBLE_RX = re.compile(
    r"^(?:here(?:'s| is)|below is|the (?:extracted|reformatted|following))[^\n]*\n+",
    re.IGNORECASE,
)


def _split_into_chunks(text: str, max_chars: int) -> list[str]:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return [text]
    lines = [ln for ln in text.split("\n") if ln.strip()]
    chunks: list[str] = []
    buf: list[str] = []
    buf_len = 0

    def _flush():
        nonlocal buf, buf_len
        if buf:
            chunks.append("\n".join(buf).strip()); buf, buf_len = [], 0

    for ln in lines:
        if len(ln) > max_chars:
            _flush()
            for sent in re.split(r"(?<=[.।!?])\s+", ln):
                if not sent:
                    continue
                if len(sent) > max_chars:
                    for i in range(0, len(sent), max_chars):
                        chunks.append(sent[i:i + max_chars].strip())
                else:
                    if buf_len + len(sent) + 1 > max_chars and buf:
                        _flush()
                    buf.append(sent); buf_len += len(sent) + 1
            _flush()
            continue
        if buf_len + len(ln) + 1 > max_chars and buf:
            _flush()
        buf.append(ln); buf_len += len(ln) + 1
    _flush()
    return [c for c in chunks if c]


def _normalise_blocks(text: str) -> str:
    if not text:
        return ""
    cleaned = text.strip()
    cleaned = _PREAMBLE_RX.sub("", cleaned, count=1).strip()
    cleaned = re.sub(r"^```[a-zA-Z]*\s*\n?", "", cleaned).strip()
    cleaned = re.sub(r"\n?```\s*$", "", cleaned).strip()

    raw_blocks = re.split(r"\n[ \t]*\n+", cleaned)
    blocks: list[str] = []
    for blk in raw_blocks:
        block_lines = [ln.rstrip() for ln in blk.splitlines() if ln.strip()]
        if len(block_lines) < 2:
            continue
        block_lines[0] = re.sub(
            r"^(?:[-*•]\s*)?(?:stock\s*[:\-]\s*)?", "", block_lines[0], flags=re.IGNORECASE
        ).strip().strip("*_`")
        block_lines[1] = re.sub(
            r"^(?:analysis\s*[:\-]\s*)", "", block_lines[1], flags=re.IGNORECASE
        ).strip()
        if not block_lines[0] or not block_lines[1]:
            continue
        blocks.append("\n".join(block_lines).strip())
    return "\n\n".join(blocks).strip()


def extract(text: str, overrides: dict | None = None) -> dict:
    text = text or ""
    if not text.strip():
        return {"success": False, "arranged_text": "", "error": "Transcript is empty"}

    cfg = get_effective_config(overrides)
    provider, model = ai_router.resolve_model(TASK, cfg.get("model"))
    temperature = float(cfg.get("temperature", 0.0))
    max_tokens = int(cfg.get("max_output_tokens", 8192))
    chunk_chars = int(cfg.get("chunk_chars", 40000))
    overlap_lines = int(cfg.get("overlap_lines", 6))
    sleep_secs = int(cfg.get("inter_chunk_sleep_secs", 1))
    target = (cfg.get("target_analyst_name") or "").strip()
    aliases = parse_aliases(cfg.get("aliases", ""))
    base_prompt = cfg.get("system_prompt") or ""

    alias_lines = "\n".join(f"  • {a}" for a in aliases) or "  (none configured)"
    header = (
        f"TARGET ANALYST: {target or '(unspecified — extract the firm analyst)'}\n"
        f"ALIASES (all refer to the SAME person — treat as one speaker):\n{alias_lines}\n\n"
    )
    system_prompt = header + base_prompt

    chunks = _split_into_chunks(text, chunk_chars)
    print(f"📈 [step04_extract_analysis] {provider}/{model} — {len(chunks)} chunk(s), target={target or '—'}")
    arranged_parts: list[str] = []

    for i, chunk in enumerate(chunks, start=1):
        if i > 1 and overlap_lines > 0:
            prev_tail = "\n".join(chunks[i - 2].splitlines()[-overlap_lines:])
            feed = (
                "=== CONTEXT FROM PREVIOUS CHUNK (read-only — do NOT emit these lines, only "
                "use them to resolve stock names for answers that begin in the NEW CHUNK) ===\n"
                f"{prev_tail}\n"
                "=== NEW CHUNK (extract the target analyst's stocks from here) ===\n"
                f"{chunk}"
            )
        else:
            feed = chunk
        try:
            out = ai_router.chat(provider, model, system_prompt, feed, max_tokens, temperature)
        except Exception as exc:
            return {"success": False, "arranged_text": "", "error": str(exc)}
        if out:
            arranged_parts.append(out)
        if i < len(chunks) and sleep_secs > 0:
            time.sleep(sleep_secs)

    if not arranged_parts:
        return {"success": False, "arranged_text": "",
                "error": f"No {target or 'analyst'} calls found in any chunk."}

    arranged = _normalise_blocks("\n\n".join(arranged_parts))
    return {"success": True, "arranged_text": arranged, "error": None}


def run(text: str, overrides: dict | None = None) -> dict:
    return extract(text, overrides=overrides)
