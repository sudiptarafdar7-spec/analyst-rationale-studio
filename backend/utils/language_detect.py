"""Cheap language heuristic — is the text already English?

Used by the translator to skip the (paid) translation call when the transcript
is already English. Detects Devanagari / large non-Latin ratios.
"""
from __future__ import annotations

import re

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
_LATIN = re.compile(r"[A-Za-z]")


def is_english(text: str) -> bool:
    if not text or not text.strip():
        return True
    sample = text[:4000]
    if _DEVANAGARI.search(sample):
        return False
    letters = _LATIN.findall(sample)
    non_ascii = [c for c in sample if ord(c) > 127]
    # Mostly Latin letters and few non-ASCII chars => treat as English.
    if len(letters) >= 20 and len(non_ascii) <= max(5, len(sample) * 0.02):
        return True
    return len(non_ascii) == 0
