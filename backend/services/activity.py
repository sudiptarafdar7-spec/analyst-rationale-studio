"""User activity logging — a human-readable audit feed.

log(...) writes one row; it never raises into the caller (best-effort), so a
logging hiccup can't break the action being logged.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from db.models import User, UserActivity


def log(
    db: Session,
    user: User | None,
    action: str,
    summary: str,
    *,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> None:
    try:
        row = UserActivity(
            user_id=(user.id if user else None),
            actor_name=(f"{user.first_name} {user.last_name}".strip() if user else None),
            action=action,
            summary=summary,
            entity_type=entity_type,
            entity_id=(str(entity_id) if entity_id is not None else None),
        )
        db.add(row)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
