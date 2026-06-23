"""Media Presence jobs — create/list/detail/edit/delete.

One job == one media appearance to be turned into a compliance PDF. Pipeline
control (start/resume/review gates) is added by the orchestrator phase; this
router owns the CRUD surface that produces a `pending` job.
"""
from __future__ import annotations

import os
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user
from db.enums import JobStatus, UploadedFileType, UserRole
from db.models import Analyst, Channel, Job, JobStep, Platform, UploadedFile, User
from db.session import get_db
from schemas.job import JobDetailOut, JobListItem, JobStepOut, JobUpdateIn

router = APIRouter(prefix="/jobs", tags=["jobs"])

AUDIO_SUBDIR = "job-audio"
MAX_AUDIO_BYTES = 500 * 1024 * 1024  # 500 MB


def _platform_label(platform: Platform | None) -> str | None:
    if platform is None:
        return None
    return platform.platform_type.value.title()


def _snapshot_channel(db: Session, platform: Platform) -> Channel:
    """Snapshot the firm-branding channel row from the selected platform.

    The PDF footer joins jobs -> channels; snapshotting at job time decouples the
    rendered PDF from later edits to the platform.
    """
    channel = Channel(
        channel_name=platform.channel_name,
        channel_logo_path=platform.channel_logo_path,
        platform=_platform_label(platform),
    )
    db.add(channel)
    db.flush()
    return channel


def _ensure_access(job: Job, user: User) -> None:
    if user.role != UserRole.admin and job.created_by != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your job")


def _audio_url(db: Session, job: Job) -> str | None:
    if not job.audio_file_id:
        return None
    f = db.get(UploadedFile, job.audio_file_id)
    return f.file_path if f else None


def _to_list_item(db: Session, job: Job) -> JobListItem:
    platform = db.get(Platform, job.platform_id) if job.platform_id else None
    analyst = db.get(Analyst, job.analyst_id) if job.analyst_id else None
    return JobListItem(
        id=job.id,
        platform_id=job.platform_id,
        platform_name=platform.channel_name if platform else None,
        analyst_id=job.analyst_id,
        analyst_name=analyst.name if analyst else None,
        title=job.title,
        youtube_url=job.youtube_url,
        video_date=job.video_date,
        video_time=job.video_time,
        extract_all_stocks=job.extract_all_stocks,
        status=job.status,
        gate=job.gate,
        current_step=job.current_step,
        audio_url=_audio_url(db, job),
        pdf_url=(f"/api/jobs/{job.id}/pdf" if job.output_pdf_path else None),
        created_at=job.created_at,
    )


def _to_detail(db: Session, job: Job) -> JobDetailOut:
    base = _to_list_item(db, job).model_dump()
    steps = db.scalars(
        select(JobStep).where(JobStep.job_id == job.id).order_by(JobStep.step_no)
    ).all()
    return JobDetailOut(
        **base,
        channel_id=job.channel_id,
        audio_file_id=job.audio_file_id,
        error_message=job.error_message,
        output_pdf_path=job.output_pdf_path,
        steps=[JobStepOut.model_validate(s) for s in steps],
    )


@router.get("", response_model=list[JobListItem])
def list_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[JobListItem]:
    stmt = select(Job).order_by(Job.created_at.desc())
    if user.role != UserRole.admin:
        stmt = stmt.where(Job.created_by == user.id)
    return [_to_list_item(db, j) for j in db.scalars(stmt).all()]


@router.post("", response_model=JobDetailOut, status_code=status.HTTP_201_CREATED)
async def create_job(
    platform_id: uuid.UUID = Form(...),
    analyst_id: uuid.UUID | None = Form(None),
    extract_all_stocks: bool = Form(False),
    youtube_url: str | None = Form(None),
    title: str | None = Form(None),
    video_date: str | None = Form(None),
    video_time: str | None = Form(None),
    audio: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDetailOut:
    platform = db.get(Platform, platform_id)
    if platform is None or not platform.is_active:
        raise HTTPException(status_code=404, detail="Platform not found")
    if analyst_id is not None and db.get(Analyst, analyst_id) is None:
        raise HTTPException(status_code=404, detail="Analyst not found")

    channel = _snapshot_channel(db, platform)

    audio_file_id = None
    if audio is not None and audio.filename:
        from utils.files import save_binary_upload

        meta = await save_binary_upload(audio, AUDIO_SUBDIR, MAX_AUDIO_BYTES, prefix="audio")
        uf = UploadedFile(
            file_type=UploadedFileType.audio,
            file_path=meta["file_path"],
            file_name=meta["file_name"],
            mime_type=meta["mime_type"],
            size_bytes=meta["size_bytes"],
            uploaded_by=user.id,
        )
        db.add(uf)
        db.flush()
        audio_file_id = uf.id

    job = Job(
        platform_id=platform.id,
        channel_id=channel.id,
        analyst_id=analyst_id,
        extract_all_stocks=extract_all_stocks,
        youtube_url=(youtube_url.strip() if youtube_url else None),
        title=(title.strip() if title else None),
        video_date=(video_date or None),
        video_time=(video_time or None),
        audio_file_id=audio_file_id,
        status=JobStatus.pending,
        created_by=user.id,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.get("/{job_id}", response_model=JobDetailOut)
def get_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDetailOut:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    return _to_detail(db, job)


@router.patch("/{job_id}", response_model=JobDetailOut)
def update_job(
    job_id: uuid.UUID,
    body: JobUpdateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> JobDetailOut:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    if job.status in (JobStatus.running, JobStatus.paused_review):
        raise HTTPException(status_code=409, detail="Cannot edit a job while it is processing.")

    if body.platform_id is not None and body.platform_id != job.platform_id:
        platform = db.get(Platform, body.platform_id)
        if platform is None or not platform.is_active:
            raise HTTPException(status_code=404, detail="Platform not found")
        job.platform_id = platform.id
        job.channel_id = _snapshot_channel(db, platform).id
    if body.analyst_id is not None:
        if db.get(Analyst, body.analyst_id) is None:
            raise HTTPException(status_code=404, detail="Analyst not found")
        job.analyst_id = body.analyst_id
    if body.title is not None:
        job.title = body.title.strip() or None
    if body.youtube_url is not None:
        job.youtube_url = body.youtube_url.strip() or None
    if body.video_date is not None:
        job.video_date = body.video_date
    if body.video_time is not None:
        job.video_time = body.video_time
    if body.extract_all_stocks is not None:
        job.extract_all_stocks = body.extract_all_stocks

    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)

    # Remove per-job artifacts on disk.
    job_dir = os.path.join(settings.JOB_FILES_DIR, str(job.id))
    if os.path.isdir(job_dir):
        shutil.rmtree(job_dir, ignore_errors=True)

    # Remove the audio upload (row + file).
    if job.audio_file_id:
        uf = db.get(UploadedFile, job.audio_file_id)
        if uf:
            abs_audio = os.path.join(settings.UPLOAD_DIR, uf.file_path.replace("/uploads/", "", 1))
            if os.path.isfile(abs_audio):
                try:
                    os.remove(abs_audio)
                except OSError:
                    pass
            db.delete(uf)

    db.delete(job)  # job_steps / job_chart_uploads cascade
    db.commit()
