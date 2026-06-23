"""Saved Rationale archive — finished jobs the user chose to keep."""
from __future__ import annotations

import os
import shutil
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.jobs import _ensure_access, _job_folder, _to_list_item
from core.deps import get_current_user
from db.enums import JobStatus, UserRole
from db.models import Job, UploadedFile, User
from db.session import get_db
from schemas.job import JobListItem

router = APIRouter(prefix="/saved", tags=["saved"])


@router.get("", response_model=list[JobListItem])
def list_saved(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[JobListItem]:
    stmt = select(Job).where(Job.status == JobStatus.saved).order_by(Job.created_at.desc())
    if user.role != UserRole.admin:
        stmt = stmt.where(Job.created_by == user.id)
    return [_to_list_item(db, j) for j in db.scalars(stmt).all()]


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Saved rationale not found")
    _ensure_access(job, user)
    shutil.rmtree(_job_folder(job.id), ignore_errors=True)
    if job.audio_file_id:
        uf = db.get(UploadedFile, job.audio_file_id)
        if uf:
            db.delete(uf)
    db.delete(job)  # cascade steps / chart-uploads / analysts
    db.commit()
