"""Media Presence jobs — create/list/detail/edit/delete + audio streaming.

One job == one media appearance to be turned into a compliance PDF. A job can
target multiple analysts (job_analysts link table); when extract_all_stocks is
set, no targets are needed and every analyst's calls are extracted. Audio is
stored under job_files/<job_id>/audio/ and streamed via an authenticated
endpoint (job_files is not web-served). Pipeline control lives in jobs_pipeline.py.
"""
from __future__ import annotations

import os
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from core.config import settings
from core.deps import get_current_user
from core.permissions import has_perm, require_perm
from services import activity
from db.enums import JobStatus, UploadedFileType, UserRole
from db.models import Analyst, Channel, Job, JobAnalyst, JobStep, Platform, UploadedFile, User
from db.session import get_db
from schemas.job import AnalystRef, JobDetailOut, JobListItem, JobStepOut, JobUpdateIn
from utils.audio import parse_timecode, trim_audio

router = APIRouter(prefix="/jobs", tags=["jobs"])

MAX_AUDIO_BYTES = 500 * 1024 * 1024  # 500 MB
AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".aac"}
AUDIO_MEDIA = {".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac"}


def _job_folder(job_id) -> str:
    return os.path.join(settings.JOB_FILES_DIR, str(job_id))


def _platform_label(platform: Platform | None) -> str | None:
    return platform.platform_type.value.title() if platform else None


def _snapshot_channel(db: Session, platform: Platform) -> Channel:
    """Snapshot the firm-branding channel row from the selected platform."""
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


def _audio_url(job: Job) -> str | None:
    return f"/api/jobs/{job.id}/audio" if job.audio_file_id else None


def _analysts_for(db: Session, job_id) -> list[AnalystRef]:
    rows = db.scalars(select(JobAnalyst).where(JobAnalyst.job_id == job_id)).all()
    refs: list[AnalystRef] = []
    for r in rows:
        a = db.get(Analyst, r.analyst_id)
        if a:
            refs.append(AnalystRef(id=a.id, name=a.name, avatar_path=a.avatar_path))
    return refs


def _set_analysts(db: Session, job: Job, analyst_ids: list[uuid.UUID]) -> None:
    """Replace the job's target-analyst set. Validates each id exists."""
    db.execute(delete(JobAnalyst).where(JobAnalyst.job_id == job.id))
    seen: set[uuid.UUID] = set()
    for aid in analyst_ids:
        if aid in seen:
            continue
        if db.get(Analyst, aid) is None:
            raise HTTPException(status_code=404, detail=f"Analyst not found: {aid}")
        db.add(JobAnalyst(job_id=job.id, analyst_id=aid))
        seen.add(aid)
    # Keep the legacy single column pointing at the first target (or None).
    job.analyst_id = next(iter(analyst_ids), None)


def _to_list_item(db: Session, job: Job) -> JobListItem:
    platform = db.get(Platform, job.platform_id) if job.platform_id else None
    started_at = db.scalar(
        select(func.min(JobStep.started_at)).where(JobStep.job_id == job.id)
    )
    return JobListItem(
        id=job.id,
        platform_id=job.platform_id,
        platform_name=platform.channel_name if platform else None,
        platform_type=platform.platform_type.value if platform else None,
        platform_logo=platform.channel_logo_path if platform else None,
        analysts=_analysts_for(db, job.id),
        title=job.title,
        youtube_url=job.youtube_url,
        video_date=job.video_date,
        video_time=job.video_time,
        extract_all_stocks=job.extract_all_stocks,
        status=job.status,
        gate=job.gate,
        current_step=job.current_step,
        started_at=started_at,
        audio_url=_audio_url(job),
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
def list_jobs(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[JobListItem]:
    stmt = select(Job).order_by(Job.created_at.desc())
    if not has_perm(user, "jobs:view_all"):
        stmt = stmt.where(Job.created_by == user.id)
    return [_to_list_item(db, j) for j in db.scalars(stmt).all()]


@router.post("", response_model=JobDetailOut, status_code=status.HTTP_201_CREATED)
async def create_job(
    platform_id: uuid.UUID = Form(...),
    channel_id: uuid.UUID | None = Form(None),
    analyst_ids: list[uuid.UUID] = Form(default=[]),
    extract_all_stocks: bool = Form(False),
    youtube_url: str | None = Form(None),
    title: str | None = Form(None),
    video_date: str | None = Form(None),
    video_time: str | None = Form(None),
    audio: UploadFile | None = File(None),
    audio_start: str | None = Form(None),
    audio_end: str | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("media:add")),
) -> JobDetailOut:
    platform = db.get(Platform, platform_id)
    if platform is None or not platform.is_active:
        raise HTTPException(status_code=404, detail="Platform not found")

    if channel_id is not None:
        channel = db.get(Channel, channel_id)
        if channel is None:
            raise HTTPException(status_code=404, detail="Channel not found")
    else:
        channel = _snapshot_channel(db, platform)

    job = Job(
        platform_id=platform.id,
        channel_id=channel.id,
        extract_all_stocks=extract_all_stocks,
        youtube_url=(youtube_url.strip() if youtube_url else None),
        title=(title.strip() if title else None),
        video_date=(video_date or None),
        video_time=(video_time or None),
        status=JobStatus.pending,
        created_by=user.id,
    )
    db.add(job)
    db.flush()  # assign job.id

    # Targets only matter when not extracting every analyst.
    _set_analysts(db, job, [] if extract_all_stocks else list(analyst_ids))

    if audio is not None and audio.filename:
        ext = os.path.splitext(audio.filename)[1].lower()
        if ext not in AUDIO_EXTS:
            raise HTTPException(status_code=415, detail="Audio must be mp3, m4a, wav or aac.")
        contents = await audio.read()
        if len(contents) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Audio exceeds the 500 MB limit.")
        audio_dir = os.path.join(_job_folder(job.id), "audio")
        os.makedirs(audio_dir, exist_ok=True)
        safe = "".join(ch for ch in os.path.basename(audio.filename) if ch.isalnum() or ch in "._- ").strip() or f"audio{ext}"
        abs_path = os.path.abspath(os.path.join(audio_dir, safe))
        with open(abs_path, "wb") as fh:
            fh.write(contents)

        # Optional trim: when the user disabled "use entire audio" and gave a
        # start/end, cut the clip and make the TRIMMED file the job's audio.
        final_path, final_name, final_size = abs_path, audio.filename, len(contents)
        start_sec = parse_timecode(audio_start)
        end_sec = parse_timecode(audio_end)
        if start_sec is not None and end_sec is not None:
            if start_sec < 0 or end_sec <= start_sec:
                raise HTTPException(status_code=422, detail="End time must be after start time.")
            trimmed_path = os.path.abspath(os.path.join(audio_dir, f"trimmed_{safe}"))
            try:
                trim_audio(abs_path, trimmed_path, start_sec, end_sec)
            except RuntimeError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            try:
                os.remove(abs_path)  # keep only the trimmed clip
            except OSError:
                pass
            final_path = trimmed_path
            final_name = f"trimmed_{audio.filename}"
            final_size = os.path.getsize(trimmed_path)

        uf = UploadedFile(
            file_type=UploadedFileType.audio, file_path=final_path, file_name=final_name,
            mime_type=audio.content_type or AUDIO_MEDIA.get(ext), size_bytes=final_size,
            uploaded_by=user.id,
        )
        db.add(uf)
        db.flush()
        job.audio_file_id = uf.id

    db.commit()
    db.refresh(job)
    activity.log(db, user, "media:add", f"Added media presence: {job.title or (platform.channel_name if platform else 'entry')}",
                 entity_type="job", entity_id=job.id)
    return _to_detail(db, job)


@router.get("/{job_id}", response_model=JobDetailOut)
def get_job(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> JobDetailOut:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    return _to_detail(db, job)


@router.get("/{job_id}/audio")
def stream_audio(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> FileResponse:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    if not job.audio_file_id:
        raise HTTPException(status_code=404, detail="No audio on this job.")
    uf = db.get(UploadedFile, job.audio_file_id)
    if not uf or not os.path.isfile(uf.file_path):
        raise HTTPException(status_code=404, detail="Audio file is missing on disk.")
    ext = os.path.splitext(uf.file_path)[1].lower()
    return FileResponse(uf.file_path, media_type=uf.mime_type or AUDIO_MEDIA.get(ext, "application/octet-stream"),
                        filename=uf.file_name or os.path.basename(uf.file_path))


@router.patch("/{job_id}", response_model=JobDetailOut)
def update_job(job_id: uuid.UUID, body: JobUpdateIn, db: Session = Depends(get_db),
               user: User = Depends(require_perm("media:edit"))) -> JobDetailOut:
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
    # Resolve the target set: explicit list, or cleared when extracting all.
    if job.extract_all_stocks:
        _set_analysts(db, job, [])
    elif body.analyst_ids is not None:
        _set_analysts(db, job, body.analyst_ids)

    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    shutil.rmtree(_job_folder(job.id), ignore_errors=True)
    if job.audio_file_id:
        uf = db.get(UploadedFile, job.audio_file_id)
        if uf:
            db.delete(uf)
    title = job.title or "entry"
    db.delete(job)  # job_steps / job_chart_uploads / job_analysts cascade
    db.commit()
    activity.log(db, user, "media:delete", f"Deleted media presence: {title}", entity_type="job", entity_id=job_id)
