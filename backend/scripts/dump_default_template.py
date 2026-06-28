"""Export the current PDF template as the baked default.

Reads the latest `pdf_template` row from the database and writes
`backend/scripts/default_pdf_template.json`. That file is what fresh installs
seed and what the "Reset design" button restores.

Run from backend/ (with the app virtualenv + .env in place):
    python -m scripts.dump_default_template
"""
from __future__ import annotations

import json
import os

from sqlalchemy import select

from db.models import PdfTemplate
from db.session import SessionLocal

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "default_pdf_template.json")


def main() -> None:
    with SessionLocal() as db:
        row = db.scalar(select(PdfTemplate).order_by(PdfTemplate.created_at.desc()))
        if row is None:
            raise SystemExit("No pdf_template row found — design a template and click Save first.")
        payload = {
            "company_name": row.company_name,
            "registration_details": row.registration_details,
            "design": row.design or {},
        }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    pages = (payload["design"] or {}).get("pages") or []
    print(f"Wrote {OUT}")
    print(f"  company_name = {payload['company_name']!r}")
    print(f"  design pages = {len(pages)}")
    print("Now commit & push default_pdf_template.json (or tell Claude to).")


if __name__ == "__main__":
    main()
