"""PDF template (branding) management — single latest row, admin only."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.deps import require_admin
from core.permissions import require_perm
from db.models import PdfTemplate, User
from db.session import get_db
from schemas.pdf_template import PdfTemplateOut, PdfTemplateUpsert

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
    row.company_name = body.company_name.strip()
    row.registration_details = body.registration_details
    row.disclaimer_text = body.disclaimer_text
    row.disclosure_text = body.disclosure_text
    row.company_data = body.company_data
    db.commit()
    db.refresh(row)
    return PdfTemplateOut.model_validate(row)
