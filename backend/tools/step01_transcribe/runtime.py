"""Runtime for Step 1 — Deepgram transcriber.

Ported from the reference deepgram tool. Every Deepgram option comes from the
admin-editable config. Outputs the three artifacts downstream steps expect.
"""
from __future__ import annotations

import json
import os
from datetime import timedelta

import pandas as pd

from core.config import settings
from tools.step01_transcribe.schema import get_effective_config
from utils.database import get_api_key


def _format_time(seconds) -> str:
    total = int(timedelta(seconds=float(seconds or 0)).total_seconds())
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    return f"{h:02}:{m:02}:{s:02}"


def _utterances_from_words(words: list) -> list:
    groups: list[dict] = []
    cur: dict | None = None
    for w in words or []:
        sp = w.get("speaker")
        if sp is None:
            sp = 0
        if cur is None or sp != cur["speaker"]:
            if cur is not None:
                groups.append(cur)
            cur = {
                "speaker": sp,
                "start": w.get("start") or 0,
                "end": w.get("end") or 0,
                "text_parts": [w.get("punctuated_word") or w.get("word") or ""],
                "confs": [w["confidence"]] if w.get("confidence") is not None else [],
            }
        else:
            cur["end"] = w.get("end") or cur["end"]
            cur["text_parts"].append(w.get("punctuated_word") or w.get("word") or "")
            if w.get("confidence") is not None:
                cur["confs"].append(w["confidence"])
    if cur is not None:
        groups.append(cur)

    out = []
    for g in groups:
        confs = g["confs"]
        out.append({
            "speaker": g["speaker"],
            "start": g["start"],
            "end": g["end"],
            "text": " ".join(p for p in g["text_parts"] if p).strip(),
            "confidence": (sum(confs) / len(confs)) if confs else None,
        })
    return out


def _speaker_label(raw) -> str:
    if raw is None:
        return "Speaker 1"
    try:
        return f"Speaker {int(raw) + 1}"
    except (TypeError, ValueError):
        return f"Speaker {raw}"


def _build_options(cfg: dict) -> dict:
    opts: dict = {
        "model": cfg.get("model") or "nova-3",
        "smart_format": bool(cfg.get("smart_format", True)),
        "diarize": bool(cfg.get("diarize", True)),
        "punctuate": bool(cfg.get("punctuate", True)),
        "paragraphs": bool(cfg.get("paragraphs", True)),
        "utterances": bool(cfg.get("utterances", False)),
        "numerals": bool(cfg.get("numerals", False)),
        "filler_words": bool(cfg.get("filler_words", False)),
        "profanity_filter": bool(cfg.get("profanity_filter", False)),
    }
    lang = (cfg.get("language") or "multi").strip()
    if lang == "detect":
        opts["detect_language"] = True
    elif lang == "multi":
        opts["language"] = "multi"
    else:
        opts["language"] = lang
    keyterms = cfg.get("keyterms") or []
    if keyterms and opts["model"].startswith("nova-3"):
        opts["keyterm"] = list(keyterms)[:100]
    return opts


def run(job_id: str, audio_path: str, api_key: str | None = None, overrides: dict | None = None) -> list[str]:
    """Transcribe ``audio_path`` with Deepgram. Returns [csv, txt, segments.json]."""
    api_key = api_key or get_api_key("deepgram")
    if not api_key:
        raise RuntimeError("Deepgram API key missing — add it under Manage API Keys.")
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    cfg = get_effective_config(overrides)
    options = _build_options(cfg)

    print("\n" + "=" * 60)
    print(f"🎙️  [step01_transcribe] Transcribing job {job_id}")
    print(f"    Model: {options.get('model')}  Language: {options.get('language') or 'auto'}")
    print("=" * 60)

    from deepgram import DeepgramClient
    from deepgram.core.request_options import RequestOptions

    deepgram = DeepgramClient(api_key=api_key)
    with open(audio_path, "rb") as fp:
        buffer_data = fp.read()
    timeout = int(cfg.get("request_timeout_seconds") or 600)
    request_options = RequestOptions(timeout_in_seconds=timeout)

    try:
        response = deepgram.listen.v1.media.transcribe_file(
            request=buffer_data, request_options=request_options, **options,
        )
    except Exception as exc:
        raise RuntimeError(f"Deepgram transcription failed: {exc}") from exc

    if hasattr(response, "model_dump"):
        result = response.model_dump(mode="json", exclude_none=True)
    elif hasattr(response, "to_dict"):
        result = response.to_dict()
    else:
        try:
            result = json.loads(response.json())
        except Exception:
            result = dict(response)

    transcripts_dir = os.path.join(settings.JOB_FILES_DIR, job_id, "transcripts")
    os.makedirs(transcripts_dir, exist_ok=True)
    try:
        with open(os.path.join(transcripts_dir, "deepgram_raw.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception as raw_err:
        print(f"⚠️  Could not save raw response: {raw_err}")

    results = result.get("results") or {}
    channels = results.get("channels") or []
    if not channels:
        raise RuntimeError("Deepgram response had no channels")
    alt = (channels[0].get("alternatives") or [{}])[0]
    whole_text = (alt.get("transcript") or "").strip()
    overall_conf = alt.get("confidence")
    words = alt.get("words") or []

    utterances = _utterances_from_words(words) if words else []
    if not utterances and whole_text:
        utterances = [{
            "speaker": 0, "start": 0,
            "end": float(result.get("metadata", {}).get("duration") or 0),
            "text": whole_text, "confidence": overall_conf,
        }]

    rows = []
    for utt in utterances:
        conf = utt.get("confidence")
        rows.append([
            _speaker_label(utt.get("speaker")),
            _format_time(utt.get("start")),
            _format_time(utt.get("end")),
            (utt.get("text") or "").strip(),
            round(float(conf), 3) if conf is not None else "",
        ])

    df_out = pd.DataFrame(rows, columns=["Speaker", "Start Time", "End Time", "Transcription", "Confidence"])
    if not df_out.empty:
        df_out["_sort"] = pd.to_timedelta(df_out["Start Time"])
        df_out = df_out.sort_values("_sort").drop(columns=["_sort"]).reset_index(drop=True)

    csv_path = os.path.join(transcripts_dir, "transcript.csv")
    df_out.to_csv(csv_path, index=False, encoding="utf-8-sig")

    txt_path = os.path.join(transcripts_dir, "transcript.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        for _, row in df_out.iterrows():
            f.write(f"[{row['Speaker']}] [{row['Start Time']} - {row['End Time']}] {row['Transcription']}\n")

    segments_payload = []
    for utt in utterances:
        conf = utt.get("confidence")
        start_s, end_s = float(utt.get("start") or 0), float(utt.get("end") or 0)
        segments_payload.append({
            "speaker": _speaker_label(utt.get("speaker")),
            "start_ms": int(start_s * 1000), "end_ms": int(end_s * 1000),
            "start": _format_time(start_s), "end": _format_time(end_s),
            "text": (utt.get("text") or "").strip(),
            "confidence": round(float(conf), 3) if conf is not None else None,
        })
    seg_path = os.path.join(transcripts_dir, "segments.json")
    with open(seg_path, "w", encoding="utf-8") as f:
        json.dump({
            "overall_confidence": round(float(overall_conf), 3) if overall_conf is not None else None,
            "model": options.get("model"), "language": options.get("language") or "auto",
            "segments": segments_payload,
        }, f, ensure_ascii=False, indent=2)

    print(f"📑 Deepgram transcript: {len(df_out)} utterance(s)")
    return [csv_path, txt_path, seg_path]
