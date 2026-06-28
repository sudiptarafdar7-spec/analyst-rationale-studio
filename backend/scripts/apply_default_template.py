"""Force the live database's PDF template to the bundled default.

Unlike seed (which only creates a template when none exists), this overwrites
the current template row with backend/scripts/default_pdf_template.json. Use it
after pushing a new default so a server that already has a template picks it up.

Run from backend/:  python -m scripts.apply_default_template
"""
from __future__ import annotations

from sqlalchemy import select

from db.models import PdfTemplate
from db.session import SessionLocal
from services.pdf_default import load_default_pdf_template


def main() -> None:
    d = load_default_pdf_template()
    if not d:
        raise SystemExit("No bundled default found (backend/scripts/default_pdf_template.json missing).")
    with SessionLocal() as db:
        row = db.scalar(select(PdfTemplate).order_by(PdfTemplate.created_at.desc()))
        if row is None:
            row = PdfTemplate(
                company_name=d.get("company_name") or "Company",
                registration_details=d.get("registration_details"),
                design=d.get("design") or {},
            )
            db.add(row)
            action = "created"
        else:
            row.company_name = d.get("company_name") or row.company_name
            row.registration_details = d.get("registration_details")
            row.design = d.get("design") or {}
            action = "updated"
        db.commit()
    pages = (d.get("design") or {}).get("pages") or []
    print(f"PDF template {action} from bundled default ({len(pages)} pages, company={d.get('company_name')!r})")


if __name__ == "__main__":
    main()
