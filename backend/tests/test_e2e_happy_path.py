"""End-to-end happy path: create job -> run -> pass both review gates -> PDF -> save.

Exercises the real orchestrator, state machine, review-gate endpoints, signed
download, and the save/archive flow. The external tool calls (Deepgram / AI /
Dhan / reportlab) are stubbed so the test needs no API keys or network — only a
reachable Postgres (DATABASE_URL). Skips cleanly if no DB is available.
"""
from __future__ import annotations

import os
import uuid

import pytest

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL or DATABASE_URL.startswith(("x", "postgresql://x")):
    pytest.skip("DATABASE_URL not configured for e2e test", allow_module_level=True)

import sys
sys.path.insert(0, ".")

from sqlalchemy import text  # noqa: E402

from db.session import SessionLocal, engine  # noqa: E402

try:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
except Exception as exc:  # noqa: BLE001
    pytest.skip(f"Database not reachable: {exc}", allow_module_level=True)

import bcrypt  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from core.security import create_access_token  # noqa: E402
from db.base import Base  # noqa: E402
import db.models  # noqa: E402,F401
from db.models import Job, Platform, User  # noqa: E402
from db.enums import JobStatus, PlatformType, UserRole  # noqa: E402
import services.pipeline as P  # noqa: E402

Base.metadata.create_all(bind=engine)  # no-op if already migrated


def _stub_adapters() -> None:
    def s(text_for_extract=None):
        def f(job, db, cfg):
            jf = P.job_folder(job.id)
            os.makedirs(os.path.join(jf, "analysis"), exist_ok=True)
            return {}
        return f

    def s4(job, db, cfg):
        jf = P.job_folder(job.id)
        os.makedirs(jf, exist_ok=True)
        open(os.path.join(jf, "extracted.txt"), "w").write("RELIANCE\nHold, target 1475\n")
        open(os.path.join(jf, "bulk-input-english.txt"), "w").write("RELIANCE\nHold, target 1475\n")
        return {}

    def s7(job, db, cfg):
        jf = P.job_folder(job.id); os.makedirs(os.path.join(jf, "analysis"), exist_ok=True)
        open(os.path.join(jf, "analysis", "mapped_master_file.csv"), "w").write(
            "DATE,TIME,INPUT STOCK,ANALYSIS,CHART TYPE,STOCK SYMBOL,SECURITY ID,EXCHANGE\n"
            "2026-06-23,10:05,RELIANCE,Hold,Daily,RELIANCE,2885,NSE\n")
        return {}

    def s9(job, db, cfg):
        jf = P.job_folder(job.id); os.makedirs(os.path.join(jf, "analysis"), exist_ok=True)
        open(os.path.join(jf, "analysis", "stocks_with_charts.csv"), "w").write(
            "INPUT STOCK,SECURITY ID,CHART PATH\nRELIANCE,2885,charts/r.png\n")
        return {"failed_count": 0}  # happy path: no chart gate

    def s10(job, db, cfg):
        jf = P.job_folder(job.id); os.makedirs(os.path.join(jf, "pdf"), exist_ok=True)
        p = os.path.join(jf, "pdf", "out.pdf"); open(p, "wb").write(b"%PDF-1.4 e2e")
        return {"output_paths": {"pdf": p}, "output_file": p}

    P.STEP_ADAPTERS = {1: s(), 2: s(), 3: s(), 4: s4, 5: s(), 6: s(), 7: s7, 8: s(), 9: s9, 10: s10}


@pytest.fixture(scope="module")
def ctx():
    _stub_adapters()
    import main
    client = TestClient(main.app, raise_server_exceptions=False)
    with SessionLocal() as db:
        admin = db.scalar(__import__("sqlalchemy").select(User).where(User.role == UserRole.admin))
        if admin is None:
            admin = User(email=f"e2e-{uuid.uuid4().hex[:8]}@test.local",
                         password_hash=bcrypt.hashpw(b"x", bcrypt.gensalt()).decode(),
                         first_name="E2E", last_name="Test", role=UserRole.admin)
            db.add(admin)
        plat = Platform(platform_type=PlatformType.youtube, channel_name="E2E Channel")
        db.add(plat); db.commit()
        aid, pid = admin.id, plat.id
    token = create_access_token(aid, "admin")
    created: list[str] = []
    yield client, {"Authorization": f"Bearer {token}"}, str(pid), created
    # teardown: remove the platform + any created jobs
    with SessionLocal() as db:
        for jid in created:
            j = db.get(Job, uuid.UUID(jid))
            if j:
                db.delete(j)
        p = db.get(Platform, pid)
        if p:
            db.delete(p)
        db.commit()


def test_happy_path(ctx):
    client, H, pid, created = ctx

    # create
    r = client.post("/api/jobs", headers=H, data={"platform_id": pid, "extract_all_stocks": "true",
                                                   "title": "E2E", "video_date": "2026-06-23", "video_time": "10:05:00"})
    assert r.status_code == 201, r.text
    jid = r.json()["id"]; created.append(jid)
    assert r.json()["status"] == "pending"

    # start -> extract gate
    assert client.post(f"/api/jobs/{jid}/start", headers=H).status_code == 200
    g = client.get(f"/api/jobs/{jid}/steps", headers=H).json()
    assert g["status"] == "paused_review" and g["gate"] == "extract_review"

    # extract gate
    assert client.get(f"/api/jobs/{jid}/review/extract", headers=H).status_code == 200
    assert client.post(f"/api/jobs/{jid}/review/extract", headers=H, json={"text": "RELIANCE\nHold, target 1475\n"}).status_code == 200
    g = client.get(f"/api/jobs/{jid}/steps", headers=H).json()
    assert g["gate"] == "mapping_review"

    # mapping gate
    m = client.get(f"/api/jobs/{jid}/review/mapping", headers=H).json()
    assert client.post(f"/api/jobs/{jid}/review/mapping", headers=H, json={"rows": m["rows"]}).status_code == 200

    # completed
    g = client.get(f"/api/jobs/{jid}/steps", headers=H).json()
    assert g["status"] == "completed" and all(s["status"] == "done" for s in g["steps"])

    # PDF available (bearer) + signed url (no bearer)
    assert client.get(f"/api/jobs/{jid}/pdf", headers=H).status_code == 200
    url = client.get(f"/api/jobs/{jid}/pdf-url", headers=H).json()["url"]
    assert client.get(url).content[:4] == b"%PDF"

    # save -> archive
    assert client.post(f"/api/jobs/{jid}/save", headers=H).json()["status"] == "saved"
    saved = client.get("/api/saved", headers=H).json()
    assert any(s["id"] == jid for s in saved)

    # structured per-job log file written
    assert os.path.isfile(os.path.join(P.job_folder(jid), "pipeline.log"))
