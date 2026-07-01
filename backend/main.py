"""FastAPI application entrypoint for Analyst Rationale Studio."""
from __future__ import annotations

import asyncio
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.ai_models import router as ai_models_router
from api.analysts import router as analysts_router
from api.api_keys import router as api_keys_router
from api.apikeys_self import router as apikeys_self_router
from api.auth import router as auth_router
from api.files import router as files_router
from api.health import router as health_router
from api.jobs import router as jobs_router
from api.jobs_pipeline import router as jobs_pipeline_router
from api.jobs_pipeline import ws_router
from api.jobs_review import router as jobs_review_router
from api.pdf_template import router as pdf_template_router
from api.platforms import router as platforms_router
from api.notifications import router as notifications_router
from api.review import router as review_router
from api.saved import router as saved_router
from api.tools import router as tools_router
from api.watchlist import router as watchlist_router
from api.users import router as users_router
from api.youtube import router as youtube_router
from core.config import settings
from services.progress_hub import hub

app = FastAPI(title="Analyst Rationale Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_db_schema() -> None:
    """Self-heal the DB schema on boot.

    A code update can add a table (e.g. job_analysts) that an already-running
    local database doesn't have yet, which otherwise surfaces as opaque 500s.
    We apply pending Alembic migrations to head; if that can't run for any
    reason, we fall back to creating only the missing tables. Best-effort —
    never blocks startup.
    """
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    try:
        from alembic import command
        from alembic.config import Config

        cfg = Config(os.path.join(backend_dir, "alembic.ini"))
        cfg.set_main_option("script_location", os.path.join(backend_dir, "migrations"))
        command.upgrade(cfg, "head")
        print("✅ Database migrations are up to date")
        return
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Alembic upgrade skipped/failed ({exc}); ensuring tables via metadata")

    try:
        from sqlalchemy import text
        from sqlalchemy.dialects import postgresql

        from db.base import Base
        from db.enums import ENUM_LABELS
        from db.session import engine
        import db.models  # noqa: F401  (registers tables)

        # 1) Extensions the schema depends on (gen_random_uuid, citext). On a
        #    fresh DB these are pre-installed by deploy.sh as the superuser;
        #    IF NOT EXISTS makes this a harmless no-op when they already exist.
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))

        # 2) Enum types. The ORM declares them with create_type=False, so
        #    create_all() will NOT create them — make every type explicitly
        #    (checkfirst skips any that already exist). MUST happen before
        #    create_all(), otherwise CREATE TABLE on a fresh DB fails.
        with engine.begin() as conn:
            for _name, _labels in ENUM_LABELS.items():
                postgresql.ENUM(*_labels, name=_name, create_type=False).create(conn, checkfirst=True)

        # 3) Tables (only the missing ones).
        Base.metadata.create_all(bind=engine)

        # 4) Idempotent column / enum-value additions for databases created by
        #    an older build. Each guarded independently so one failure can't
        #    abort the rest; all are no-ops on a freshly created schema.
        def _try(sql: str) -> None:
            try:
                with engine.begin() as conn:
                    conn.execute(text(sql))
            except Exception as _e:  # noqa: BLE001
                print(f"   (skip) {sql[:60]}... -> {_e}")

        _try("ALTER TYPE ai_task ADD VALUE IF NOT EXISTS 'watchlist'")
        _try("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'reviewer'")
        _try("ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'signed'")
        _try("ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb")
        _try("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_pdf_path text")
        _try("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_at timestamptz")
        _try("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_by uuid")
        _try("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS raw_cleaned boolean NOT NULL DEFAULT false")
        _try("ALTER TABLE pdf_template ADD COLUMN IF NOT EXISTS design jsonb")
        for _col in ("disclaimer_text", "disclosure_text", "company_data"):
            _try(f"ALTER TABLE pdf_template DROP COLUMN IF EXISTS {_col}")

        # 5) One-time permission backfill: only if nobody has permissions yet, so
        #    admin's later edits are never overwritten on subsequent boots.
        with engine.begin() as conn:
            granted = conn.execute(text(
                "SELECT count(*) FROM users WHERE permissions <> '[]'::jsonb"
            )).scalar() or 0
            if granted == 0:
                emp = ('["media:add","media:edit","media:delete","rationale:run",'
                       '"rationale:review","chart:generate","watchlist:view",'
                       '"watchlist:refresh","watchlist:delete","jobs:view_all"]')
                conn.execute(text("UPDATE users SET permissions = '[\"*\"]'::jsonb WHERE role = 'admin'"))
                conn.execute(text(f"UPDATE users SET permissions = '{emp}'::jsonb WHERE role = 'employee'"))
        print("\u2705 Ensured database tables via metadata")
    except Exception as exc:  # noqa: BLE001
        print(f"\u26a0\ufe0f  Could not ensure DB schema automatically: {exc}")


@app.on_event("startup")
async def _on_startup() -> None:
    # Bridge worker-thread progress publishes onto this event loop.
    hub.bind_loop(asyncio.get_running_loop())
    # Apply pending migrations so the app self-heals after schema-changing updates.
    await asyncio.to_thread(_ensure_db_schema)
    # Retention sweep: prune raw artifacts of rationales signed > 7 days ago.
    try:
        from services.cleanup import run_retention

        n = await asyncio.to_thread(run_retention)
        if n:
            print(f"🧹 Retention: pruned raw files for {n} signed job(s)")
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  Retention sweep skipped: {exc}")


# Routes under /api
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(api_keys_router, prefix="/api")
app.include_router(apikeys_self_router, prefix="/api")
app.include_router(platforms_router, prefix="/api")
app.include_router(analysts_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(pdf_template_router, prefix="/api")
app.include_router(ai_models_router, prefix="/api")
app.include_router(youtube_router, prefix="/api")
app.include_router(tools_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(jobs_pipeline_router, prefix="/api")
app.include_router(jobs_review_router, prefix="/api")
app.include_router(saved_router, prefix="/api")
app.include_router(watchlist_router, prefix="/api")
app.include_router(review_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(ws_router)  # WS /ws/jobs/{id} (no /api prefix)

# Serve uploaded files (avatars, logos, ...) from the upload dir.
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/")
def root() -> dict:
    return {"name": "Analyst Rationale Studio API", "docs": "/docs"}
