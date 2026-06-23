"""Step 1 — Transcribe (Deepgram).

run(job_id, audio_path, api_key=None, overrides=None) -> list[str]
Writes transcripts/{transcript.csv, transcript.txt, segments.json, deepgram_raw.json}.
"""
from .runtime import run  # noqa: F401
