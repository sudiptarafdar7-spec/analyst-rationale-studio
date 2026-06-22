"""Health check router."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    """Liveness + DB connectivity check.

    Returns {status: "ok"} when the API is up. `database` is "ok" when a
    trivial query succeeds, otherwise "unavailable" (the API still reports
    healthy so the check works before Postgres is provisioned).
    """
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"
    return {"status": "ok", "database": db_status}
