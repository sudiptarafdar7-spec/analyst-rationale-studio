"""Review workflow — pending review queue, sign-off, and signed archive.

'Send to reviewer' parks a finished job at status=saved (pending review). A
reviewer/admin uploads a signed PDF, flipping it to status=signed; from then on
the signed PDF is the canonical download and only a reviewer can delete it.
"""
from __future__ import annotations

import datetime as dt
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from api.jobs import _ensure_access, _to_list_item
from core.deps import get_current_user
from core.permissions import has_perm, require_perm
from db.enums import JobStatus
from db.models import Analyst, Job, JobAnalyst, Platform, User
from db.session import get_db
from schemas.job import JobListItem
from services import activity
from services.pipeline import job_folder

router = APIRouter(prefix="/review", tags=["review"])


class SignedFacets(BaseModel):
    platforms: list[dict] = []
    channels: list[dict] = []
    analysts: list[dict] = []
    years: list[int] = []


class SignedListOut(BaseModel):
    items: list[JobListItem]
    total: int
    facets: SignedFacets


def _visible(stmt, user: User):
    if not has_perm(user, "jobs:view_all"):
        stmt = stmt.where(Job.created_by == user.id)
    return stmt


@router.get("/pending", response_model=list[JobListItem])
def list_pending(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[JobListItem]:
    stmt = _visible(select(Job).where(Job.status == JobStatus.saved).order_by(Job.created_at.desc()), user)
    return [_to_list_item(db, j) for j in db.scalars(stmt).all()]


@router.get("/signed", response_model=SignedListOut)
def list_signed(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    platform_type: str | None = Query(None),
    channel_id: uuid.UUID | None = Query(None),
    analyst_id: uuid.UUID | None = Query(None),
    year: int | None = Query(None),
    month: int | None = Query(None),
    day: int | None = Query(None),
    q: str | None = Query(None),
) -> SignedListOut:
    base = _visible(select(Job).where(Job.status == JobStatus.signed), user)
    jobs = db.scalars(base.order_by(Job.signed_at.desc().nullslast())).all()

    # Build facets across the full signed set (before applying filters).
    plat_ids = {j.platform_id for j in jobs if j.platform_id}
    plats = {p.id: p for p in db.scalars(select(Platform).where(Platform.id.in_(plat_ids))).all()} if plat_ids else {}
    analyst_links = db.scalars(select(JobAnalyst).where(JobAnalyst.job_id.in_([j.id for j in jobs]))).all() if jobs else []
    job_analyst_ids: dict = {}
    for link in analyst_links:
        job_analyst_ids.setdefault(link.job_id, set()).add(link.analyst_id)
    a_ids = {aid for s in job_analyst_ids.values() for aid in s}
    analysts = {a.id: a for a in db.scalars(select(Analyst).where(Analyst.id.in_(a_ids))).all()} if a_ids else {}

    def _date(j: Job):
        return j.signed_at or j.created_at

    _PLABEL = {"youtube": "YouTube", "facebook": "Facebook", "instagram": "Instagram",
               "telegram": "Telegram", "whatsapp": "WhatsApp", "other": "Other"}
    _types_present: dict[str, int] = {}
    for _j in jobs:
        _p = plats.get(_j.platform_id)
        if _p:
            _t = _p.platform_type.value
            _types_present[_t] = _types_present.get(_t, 0) + 1
    facet_platforms = [{"value": t, "label": _PLABEL.get(t, t.title())} for t in _types_present]
    facet_channels = [
        {"id": str(p.id), "name": p.channel_name, "platform_type": p.platform_type.value}
        for p in plats.values()
    ]
    facet_analysts = [{"id": str(a.id), "name": a.name} for a in analysts.values()]
    facet_years = sorted({_date(j).year for j in jobs if _date(j)}, reverse=True)

    # Apply filters.
    def keep(j: Job) -> bool:
        d = _date(j)
        jp = plats.get(j.platform_id)
        if platform_type and (jp is None or jp.platform_type.value != platform_type):
            return False
        if channel_id and j.platform_id != channel_id:
            return False
        if analyst_id and analyst_id not in job_analyst_ids.get(j.id, set()):
            return False
        if year and (not d or d.year != year):
            return False
        if month and (not d or d.month != month):
            return False
        if day and (not d or d.day != day):
            return False
        if q:
            ql = q.strip().lower()
            hay = f"{j.title or ''} {plats.get(j.platform_id).channel_name if plats.get(j.platform_id) else ''}".lower()
            if ql not in hay:
                return False
        return True

    filtered = [j for j in jobs if keep(j)]
    return SignedListOut(
        items=[_to_list_item(db, j) for j in filtered],
        total=len(filtered),
        facets=SignedFacets(platforms=facet_platforms, channels=facet_channels, analysts=facet_analysts, years=facet_years),
    )


@router.post("/{job_id}/sign", response_model=JobListItem)
async def sign_job(
    job_id: uuid.UUID,
    pdf: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(require_perm("review:sign")),
) -> JobListItem:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in (JobStatus.saved, JobStatus.signed):
        raise HTTPException(status_code=409, detail="Only a job sent for review can be signed.")
    if not (pdf.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Signed file must be a PDF.")
    contents = await pdf.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty PDF.")

    signed_dir = os.path.join(job_folder(job.id), "signed")
    os.makedirs(signed_dir, exist_ok=True)
    abs_path = os.path.abspath(os.path.join(signed_dir, f"signed_{job.id}.pdf"))
    with open(abs_path, "wb") as fh:
        fh.write(contents)

    job.signed_pdf_path = abs_path
    job.signed_at = dt.datetime.now(dt.timezone.utc)
    job.signed_by = user.id
    job.status = JobStatus.signed
    db.commit()
    db.refresh(job)
    activity.log(db, user, "review:sign", f"Signed rationale: {job.title or 'a job'}", entity_type="job", entity_id=job.id)
    return _to_list_item(db, job)


@router.get("/{job_id}/signed-pdf")
def get_signed_pdf(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> FileResponse:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    _ensure_access(job, user)
    if not job.signed_pdf_path or not os.path.isfile(job.signed_pdf_path):
        raise HTTPException(status_code=404, detail="Signed PDF not available.")
    fname = f"{(job.title or 'rationale').replace(' ', '_')}-signed.pdf"
    return FileResponse(job.signed_pdf_path, media_type="application/pdf", filename=fname)
