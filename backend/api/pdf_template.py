"""PDF template (branding) management — single latest row, admin only."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

import base64
import csv
import os
import re

from core.deps import require_admin
from core.permissions import require_perm
from db.enums import JobStatus, UploadedFileType
from db.models import Channel, Job, PdfTemplate, UploadedFile, User
from db.session import get_db
from schemas.pdf_template import PdfTemplateOut, PdfTemplateUpsert
from services.pipeline import job_folder
from utils.path_utils import resolve_uploaded_file_path

router = APIRouter(prefix="/admin/pdf-template", tags=["admin:pdf-template"])


def _latest(db: Session) -> PdfTemplate | None:
    return db.scalar(select(PdfTemplate).order_by(PdfTemplate.created_at.desc()))


@router.get("", response_model=PdfTemplateOut | None)
def get_template(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("admin:pdf_template")),
) -> PdfTemplateOut | None:
    row = _latest(db)
    return PdfTemplateOut.model_validate(row) if row else None


@router.put("", response_model=PdfTemplateOut)
def upsert_template(
    body: PdfTemplateUpsert,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("admin:pdf_template")),
) -> PdfTemplateOut:
    row = _latest(db)
    if row is None:
        row = PdfTemplate(company_name=body.company_name)
        db.add(row)
    row.company_name = body.company_name.strip() or row.company_name or "Company"
    row.registration_details = body.registration_details
    row.design = body.design
    db.commit()
    db.refresh(row)
    return PdfTemplateOut.model_validate(row)


def _strip_html(t: str | None) -> str:
    t = t or ""
    return " ".join(re.sub(r"<[^>]+>", " ", t).split()) if ("<" in t and ">" in t) else t


def _b64_image(path: str | None) -> str | None:
    if not path:
        return None
    ap = resolve_uploaded_file_path(path) if not os.path.isabs(path) else path
    if not ap or not os.path.exists(ap) or os.path.getsize(ap) > 4_000_000:
        return None
    ext = os.path.splitext(ap)[1].lstrip(".").lower() or "png"
    mime = "jpeg" if ext in ("jpg", "jpeg") else ext
    try:
        return f"data:image/{mime};base64," + base64.b64encode(open(ap, "rb").read()).decode()
    except Exception:
        return None


@router.get("/sample")
def sample_data(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_perm("admin:pdf_template")),
) -> dict:
    """Real example data from the most recent job that has generated stocks, so the
    builder preview shows a true stock name / symbol / analysis / chart."""
    tpl = _latest(db)
    clogo = db.scalar(
        select(UploadedFile).where(UploadedFile.file_type == UploadedFileType.companyLogo)
        .order_by(UploadedFile.uploaded_at.desc())
    )
    out: dict = {
        "company_name": (tpl.company_name if tpl else "") or "Acme Research Pvt. Ltd.",
        "registration": _strip_html(tpl.registration_details if tpl else "") or "SEBI Reg: INH000000000",
        "channel": "Money9", "platform": "YouTube", "url": "youtu.be/abc123", "stock": None,
        "company_logo": _b64_image(clogo.file_path if clogo else None), "channel_logo": None,
    }
    jobs = db.scalars(
        select(Job).where(Job.status.in_([JobStatus.completed, JobStatus.saved, JobStatus.signed]))
        .order_by(Job.created_at.desc()).limit(25)
    ).all()
    for job in jobs:
        csv_path = os.path.join(job_folder(job.id), "analysis", "stocks_with_charts.csv")
        if not os.path.exists(csv_path):
            continue
        try:
            with open(csv_path, encoding="utf-8-sig", newline="") as fh:
                rows = list(csv.DictReader(fh))
        except Exception:
            continue
        if not rows:
            continue
        r = {k.strip().upper(): (v or "") for k, v in rows[0].items()}
        chan = db.get(Channel, job.channel_id) if job.channel_id else None
        if chan:
            out["channel"] = chan.channel_name
            out["platform"] = chan.platform or out["platform"]
            out["channel_logo"] = _b64_image(chan.channel_logo_path) or out["channel_logo"]
        out["url"] = job.youtube_url or out["url"]
        chart_data = None
        cp = (r.get("CHART PATH") or "").strip()
        if cp:
            if not os.path.isabs(cp):
                cp = os.path.join(job_folder(job.id), cp)
            if os.path.exists(cp) and os.path.getsize(cp) < 4_000_000:
                try:
                    chart_data = "data:image/png;base64," + base64.b64encode(open(cp, "rb").read()).decode()
                except Exception:
                    chart_data = None
        out["stock"] = {
            "stock_name": r.get("LISTED NAME") or r.get("INPUT STOCK") or "Reliance Industries",
            "stock_symbol": r.get("STOCK SYMBOL") or "RELIANCE",
            "short_name": r.get("SHORT NAME") or r.get("STOCK SYMBOL") or "RELIANCE",
            "date": r.get("DATE") or "",
            "analysis": r.get("ANALYSIS") or "",
            "chart": chart_data,
        }
        break
    return out
