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
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.jobs import _ensure_access
from core.config import settings
from core.security import decode_access_token
from db.enums import JobStatus
from db.models import Job, JobStep, User
from db.session import SessionLocal, get_db
from core.deps import get_current_user
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


@router.get("/{job_id}/artifact")
def get_artifact(
    job_id: uuid.UUID,
    key: str = Query(..., description="One of the whitelisted artifact keys"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    _load_owned(job_id, db, user)
    rel = ARTIFACTS.get(key)
    if rel is None:
        raise HTTPException(status_code=400, detail=f"Unknown artifact key: {key}")
    path = os.path.join(pipeline.job_folder(job_id), rel)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Artifact not available yet.")
    return FileResponse(path, filename=os.path.basename(path))


@router.get("/{job_id}/pdf")
def get_pdf(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FileResponse:
    job = _load_owned(job_id, db, user)
    if not job.output_pdf_path or not os.path.isfile(job.output_pdf_path):
        raise HTTPException(status_code=404, detail="PDF not available.")
    return FileResponse(job.output_pdf_path, media_type="application/pdf",
                        filename=os.path.basename(job.output_pdf_path))


@router.post("/{job_id}/save")
def save_job(
    job_id: uuid.UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    if job.status not in (JobStatus.completed, JobStatus.saved):
        raise HTTPException(status_code=409, detail="Only a completed job can be saved.")
    job.status = JobStatus.saved
    db.commit()
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
