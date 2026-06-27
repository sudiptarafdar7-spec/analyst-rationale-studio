"""Retention cleanup for signed rationales.

7 days after a job is signed we keep only: the signed PDF, the Extract-analysis
output, and the Generate-charts CSV. Everything else (audio, transcript,
translation, speaker output, raw chart PNGs, the unsigned PDF, intermediate
CSVs) is deleted. Idempotent via the jobs.raw_cleaned flag.
"""
from __future__ import annotations

import datetime as dt
import os
import shutil

from sqlalchemy import select
from sqlalchemy.orm import Session

from db.enums import JobStatus
from db.models import Job, UploadedFile
from db.session import SessionLocal
from services.pipeline import job_folder

RETENTION_DAYS = 7

# Relative paths inside the job folder to KEEP.
_KEEP_TOP = {"signed", "bulk-input-english.txt", "extracted.txt"}
_KEEP_ANALYSIS = {"stocks_with_charts.csv"}


def _prune_job_folder(folder: str) -> None:
    if not os.path.isdir(folder):
        return
    for entry in os.listdir(folder):
        path = os.path.join(folder, entry)
        if entry in _KEEP_TOP:
            continue
        if entry == "analysis" and os.path.isdir(path):
            for f in os.listdir(path):
                if f not in _KEEP_ANALYSIS:
                    fp = os.path.join(path, f)
                    shutil.rmtree(fp, ignore_errors=True) if os.path.isdir(fp) else _rm(fp)
            continue
        shutil.rmtree(path, ignore_errors=True) if os.path.isdir(path) else _rm(path)


def _rm(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def cleanup_job(db: Session, job: Job) -> bool:
    """Prune one signed job's raw artifacts. Returns True if it did work."""
    _prune_job_folder(job_folder(job.id))
    # Drop the audio upload record (file already removed with audio/).
    if job.audio_file_id:
        uf = db.get(UploadedFile, job.audio_file_id)
        if uf:
            db.delete(uf)
        job.audio_file_id = None
    job.raw_cleaned = True
    db.commit()
    return True


def run_retention(db: Session | None = None) -> int:
    """Clean every signed job older than the retention window. Returns count."""
    own = db is None
    db = db or SessionLocal()
    try:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=RETENTION_DAYS)
        jobs = db.scalars(
            select(Job).where(
                Job.status == JobStatus.signed,
                Job.raw_cleaned.is_(False),
                Job.signed_at.is_not(None),
                Job.signed_at < cutoff,
            )
        ).all()
        n = 0
        for job in jobs:
            try:
                cleanup_job(db, job)
                n += 1
            except Exception:  # noqa: BLE001
                db.rollback()
        return n
    finally:
        if own:
            db.close()
