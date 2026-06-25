"""Audio helpers — timecode parsing + lossless/clean trimming via ffmpeg.

Trimming is used by Media Presence: when the user turns off "use entire audio"
and supplies a start/end, the uploaded file is cut to that window and the
trimmed clip becomes the job's audio for transcription.
"""
from __future__ import annotations

import os
import shutil
import subprocess


def parse_timecode(value: str | None) -> float | None:
    """Parse 'HH:MM:SS(.ms)', 'MM:SS', or plain seconds into float seconds.

    Returns None if empty/invalid (caller decides whether that's an error).
    """
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        if ":" in s:
            secs = 0.0
            for part in s.split(":"):
                secs = secs * 60 + float(part)
            return secs
        return float(s)
    except ValueError:
        return None


def ffmpeg_exe() -> str | None:
    """Resolve an ffmpeg binary: system PATH first, else the one bundled with
    the imageio-ffmpeg package (a static build, no system install needed)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return None


def have_ffmpeg() -> bool:
    return ffmpeg_exe() is not None


def trim_audio(src: str, dst: str, start: float, end: float) -> None:
    """Cut src[start..end] (seconds) into dst. Re-encodes for sample accuracy.

    Uses input seeking (-ss before -i) for speed plus a relative -t so the cut
    stays accurate on large files. Raises RuntimeError on any failure.
    """
    exe = ffmpeg_exe()
    if not exe:
        raise RuntimeError(
            "Audio trimming requires ffmpeg. Install the 'imageio-ffmpeg' package "
            "(pip install imageio-ffmpeg) or a system ffmpeg, then retry."
        )
    if end <= start:
        raise RuntimeError("End time must be after start time.")
    duration = end - start
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    cmd = [
        exe, "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-i", src, "-t", f"{duration:.3f}",
        "-vn", dst,
    ]
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0 or not os.path.exists(dst) or os.path.getsize(dst) == 0:
        tail = proc.stderr.decode("utf-8", "ignore")[-400:]
        raise RuntimeError(f"Audio trim failed: {tail or 'unknown ffmpeg error'}")
