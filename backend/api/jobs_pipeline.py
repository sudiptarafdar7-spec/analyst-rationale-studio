"""Pipeline control + progress for jobs.

Adds the start/restart/resume/retry-step/steps/artifact/pdf/save endpoints (all
under /jobs) and the WS progress stream. The pipeline itself runs in a worker
thread via BackgroundTasks; this module only validates, enqueues, and reports.
Review-gate submission UIs come in a later phase — here we just pause and expose
gate state.
"""
from __future__ import annotations

import os
import uuid

from fastapi import (
    APIRouter, BackgroundTasks, Depends, HTTPException, Query, WebSocket,
    WebSocketDisconnect, status,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from api.jobs import _ensure_access
from core.config import settings
from core.security import decode_access_token
from db.enums import GateKind, JobStatus
from db.models import Job, JobStep, User
from db.session import SessionLocal, get_db
from core.deps import get_current_user, get_optional_user
from core.signing import DEFAULT_TTL_SECONDS, sign_path, verify_path
from schemas.job import JobStepOut
from services import pipeline
from services.progress_hub import hub

router = APIRouter(prefix="/jobs", tags=["pipeline"])
ws_router = APIRouter()

# Whitelisted intermediate artifacts (key -> path relative to the job folder).
ARTIFACTS = {
    "transcript": "transcripts/transcript.txt",
    "transcript_csv": "transcripts/transcript.csv",
    "segments": "transcripts/segments.json",
    "translated": "translated.txt",
    "speakers": "speakers.txt",
    "extracted": "extracted.txt",
    "bulk_input_english": "bulk-input-english.txt",
    "bulk_input": "analysis/bulk-input.csv",
    "polished": "analysis/bulk-input-analysis.csv",
    "mapped": "analysis/mapped_master_file.csv",
    "cmp": "analysis/stocks_with_cmp.csv",
    "charts_csv": "analysis/stocks_with_charts.csv",
    "failed_charts": "analysis/failed_charts.json",
}


class RetryStepIn(BaseModel):
    step_no: int


class StepsOut(BaseModel):
    status: JobStatus
    gate: str
    current_step: int
    steps: list[JobStepOut]


def _load_owned(job_id: uuid.UUID, db: Session, user: User) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    return job


@router.post("/{job_id}/start")
def start_job(
    job_id: uuid.UUID,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    if job.status in (JobStatus.running, JobStatus.paused_review):
        raise HTTPException(status_code=409, detail="Job is already in progress.")
    job.status = JobStatus.running
    job.current_step = 1
    db.commit()
    bg.add_task(pipeline.run_pipeline, job_id, 1)
    return {"status": "running", "message": "Pipeline started."}


@router.post("/{job_id}/restart")
def restart_job(
    job_id: uuid.UUID,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _load_owned(job_id, db, user)
    bg.add_task(pipeline.restart, job_id)
    return {"status": "running", "message": "Pipeline restarting from step 1."}


@router.post("/{job_id}/resume")
def resume_job(
    job_id: uuid.UUID,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    if job.status != JobStatus.paused_review:
        raise HTTPException(status_code=409, detail="Job is not paused at a review gate.")
    bg.add_task(pipeline.resume, job_id)
    return {"status": "running", "message": f"Resuming from step {job.current_step}."}


@router.post("/{job_id}/retry-step")
def retry_step(
    job_id: uuid.UUID,
    body: RetryStepIn,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    _load_owned(job_id, db, user)
    if not (1 <= body.step_no <= 10):
        raise HTTPException(status_code=422, detail="step_no must be between 1 and 10")
    bg.add_task(pipeline.retry_step, job_id, body.step_no)
    return {"status": "running", "message": f"Re-running from step {body.step_no}."}


@router.get("/{job_id}/steps", response_model=StepsOut)
def get_steps(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StepsOut:
    job = _load_owned(job_id, db, user)
    steps = db.scalars(
        select(JobStep).where(JobStep.job_id == job_id).order_by(JobStep.step_no)
    ).all()
    return StepsOut(
        status=job.status,
        gate=job.gate.value,
        current_step=job.current_step,
        steps=[JobStepOut.model_validate(s) for s in steps],
    )


def _authorize_download(job_id, resource: str, db, user, sig, exp):
    """Allow access via a valid signed URL, else fall back to bearer ownership."""
    if sig and exp and verify_path(resource, exp, sig):
        job = db.get(Job, job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return job
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    return _load_owned(job_id, db, user)


@router.get("/{job_id}/artifact-url")
def artifact_signed_url(
    job_id: uuid.UUID, key: str = Query(...),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
) -> dict:
    _load_owned(job_id, db, user)
    if key not in ARTIFACTS:
        raise HTTPException(status_code=400, detail=f"Unknown artifact key: {key}")
    resource = f"jobs/{job_id}/artifact/{key}"
    sig, exp = sign_path(resource)
    return {"url": f"/api/jobs/{job_id}/artifact?key={key}&exp={exp}&sig={sig}", "expires_in": DEFAULT_TTL_SECONDS}


@router.get("/{job_id}/artifact")
def get_artifact(
    job_id: uuid.UUID,
    key: str = Query(..., description="One of the whitelisted artifact keys"),
    exp: int | None = Query(None), sig: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> FileResponse:
    _authorize_download(job_id, f"jobs/{job_id}/artifact/{key}", db, user, sig, exp)
    rel = ARTIFACTS.get(key)
    if rel is None:
        raise HTTPException(status_code=400, detail=f"Unknown artifact key: {key}")
    path = os.path.join(pipeline.job_folder(job_id), rel)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Artifact not available yet.")
    return FileResponse(path, filename=os.path.basename(path))


@router.get("/{job_id}/pdf-url")
def pdf_signed_url(
    job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user),
) -> dict:
    _load_owned(job_id, db, user)
    sig, exp = sign_path(f"jobs/{job_id}/pdf")
    return {"url": f"/api/jobs/{job_id}/pdf?exp={exp}&sig={sig}", "expires_in": DEFAULT_TTL_SECONDS}


@router.get("/{job_id}/pdf")
def get_pdf(
    job_id: uuid.UUID,
    exp: int | None = Query(None), sig: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> FileResponse:
    job = _authorize_download(job_id, f"jobs/{job_id}/pdf", db, user, sig, exp)
    if not job.output_pdf_path or not os.path.isfile(job.output_pdf_path):
        raise HTTPException(status_code=404, detail="PDF not available.")
    return FileResponse(job.output_pdf_path, media_type="application/pdf",
                        filename=os.path.basename(job.output_pdf_path))


@router.post("/{job_id}/reset")
def reset_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Discard the rationale run and return the entry to 'pending' (keeps audio),
    so Media Presence shows the Start button again."""
    job = _load_owned(job_id, db, user)
    db.execute(delete(JobStep).where(JobStep.job_id == job_id))
    job.status = JobStatus.pending
    job.gate = GateKind.none
    job.current_step = 0
    job.error_message = None
    job.output_pdf_path = None
    db.commit()
    import shutil
    jf = pipeline.job_folder(job_id)
    for name in ("transcripts", "analysis", "charts", "pdf"):
        shutil.rmtree(os.path.join(jf, name), ignore_errors=True)
    if os.path.isdir(jf):
        for fn in os.listdir(jf):
            if fn.endswith(".txt"):
                try:
                    os.remove(os.path.join(jf, fn))
                except OSError:
                    pass
    return {"status": "pending"}


def _build_watchlist_bg(job_id: uuid.UUID, user_id) -> None:
    """Background: extract standardised calls from the saved PDF into the watchlist."""
    from services import watchlist as wl

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        try:
            n = wl.build_from_job(db, job, created_by=user_id)
            print(f"📊 Watchlist: built {n} call(s) from job {job_id}")
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print(f"⚠️  Watchlist build failed for job {job_id}: {exc}")


@router.post("/{job_id}/save")
def save_job(
    job_id: uuid.UUID,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    if job.status not in (JobStatus.completed, JobStatus.saved):
        raise HTTPException(status_code=409, detail="Only a completed job can be saved.")
    job.status = JobStatus.saved
    db.commit()
    # Lift the call data into the Stock Analysis watchlist (AI extraction) off-thread.
    background.add_task(_build_watchlist_bg, job_id, user.id)
    return {"status": "saved"}


@ws_router.websocket("/ws/jobs/{job_id}")
async def ws_job_progress(websocket: WebSocket, job_id: uuid.UUID, token: str = Query(default="")):
    """Live progress stream. Auth via ?token=<access>. Replays history first."""
    payload = decode_access_token(token) if token else None
    if not payload:
        await websocket.close(code=4401)
        return
    # Authorize against the job.
    with SessionLocal() as db:
        try:
            user = db.get(User, uuid.UUID(payload.get("sub", "")))
        except (ValueError, TypeError):
            user = None
        job = db.get(Job, job_id)
        if user is None or not user.is_active or job is None:
            await websocket.close(code=4404)
            return
        from db.enums import UserRole

        if user.role != UserRole.admin and job.created_by != user.id:
            await websocket.close(code=4403)
            return

    await websocket.accept()
    queue = hub.subscribe(job_id)
    try:
        for event in hub.history(job_id):  # replay what was missed
            await websocket.send_json(event)
        while True:
            event = await queue.get()
            await websocket.send_json(event)
            if event.get("type") in ("done", "error"):
                # keep the socket open briefly so the client can read final state
                continue
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(job_id, queue)
