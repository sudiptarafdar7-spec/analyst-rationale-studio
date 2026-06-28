"""User notifications — best-effort writes (never break the caller)."""
from __future__ import annotations

from sqlalchemy.orm import Session

from db.models import Notification


def notify(db: Session, user_id, job_id, kind: str, title: str, body: str | None = None) -> None:
    if not user_id:
        return
    try:
        db.add(Notification(user_id=user_id, job_id=job_id, kind=kind, title=title, body=body))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
