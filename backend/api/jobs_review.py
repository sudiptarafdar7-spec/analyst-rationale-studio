"""Review-gate endpoints (docs/04 review gates).

Three gates pause the pipeline; each has a GET (serve the artifact to edit) and
a POST (persist the edit, then resume the pipeline from the next step):

  extract_review  (after step 4)  -> writes bulk-input-english.txt, resumes at 5
  mapping_review  (after step 7)  -> rewrites mapped_master_file.csv, resumes at 8
  chart_upload    (during step 9) -> drops uploaded images into charts/ and sets
                                     CHART PATH in stocks_with_charts.csv, resumes at 10
"""
from __future__ import annotations

import csv
import io
import json
import os
import uuid

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status,
)
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.jobs_pipeline import _load_owned
from db.enums import GateKind, JobStatus
from db.models import JobChartUpload, User
from db.session import get_db
from core.deps import get_current_user
from services import pipeline

router = APIRouter(prefix="/jobs", tags=["review"])

ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024


# --------------------------- schemas ---------------------------------------- #
class ExtractReviewOut(BaseModel):
    text: str


class ExtractReviewIn(BaseModel):
    text: str


class MappingReviewOut(BaseModel):
    columns: list[str]
    rows: list[dict]


class MappingReviewIn(BaseModel):
    rows: list[dict]


class FailedChart(BaseModel):
    index: int
    stock_name: str | None = None
    symbol: str | None = None
    short_name: str | None = None
    security_id: str | None = None
    error: str | None = None


class ChartsReviewOut(BaseModel):
    failed: list[FailedChart]


# --------------------------- helpers ---------------------------------------- #
def _require_gate(job, gate: GateKind) -> None:
    if job.status != JobStatus.paused_review or job.gate != gate:
        raise HTTPException(status_code=409, detail=f"Job is not paused at the {gate.value} gate.")


def _jf(job_id) -> str:
    return pipeline.job_folder(job_id)


def _resume(bg: BackgroundTasks, db: Session, job) -> None:
    job.status = JobStatus.running
    job.gate = GateKind.none
    db.commit()
    bg.add_task(pipeline.resume, job.id)


# --------------------------- extract gate ----------------------------------- #
@router.get("/{job_id}/review/extract", response_model=ExtractReviewOut)
def get_extract(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ExtractReviewOut:
    job = _load_owned(job_id, db, user)
    jf = _jf(job_id)
    # Prefer the (possibly already-edited) Step-5 input; fall back to raw extracted.
    for name in ("bulk-input-english.txt", "extracted.txt"):
        path = os.path.join(jf, name)
        if os.path.isfile(path):
            with open(path, "r", encoding="utf-8") as f:
                return ExtractReviewOut(text=f.read())
    raise HTTPException(status_code=404, detail="Extracted text not available yet.")


@router.post("/{job_id}/review/extract")
def post_extract(
    job_id: uuid.UUID,
    body: ExtractReviewIn,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    _require_gate(job, GateKind.extract_review)
    jf = _jf(job_id)
    os.makedirs(jf, exist_ok=True)
    with open(os.path.join(jf, "bulk-input-english.txt"), "w", encoding="utf-8") as f:
        f.write(body.text)
    _resume(bg, db, job)
    return {"status": "running", "message": "Saved edits; resuming from step 5."}


# --------------------------- mapping gate ----------------------------------- #
def _read_csv(path: str) -> tuple[list[str], list[dict]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        cols = list(reader.fieldnames or [])
        rows = [dict(r) for r in reader]
    return cols, rows


@router.get("/{job_id}/review/mapping", response_model=MappingReviewOut)
def get_mapping(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> MappingReviewOut:
    _load_owned(job_id, db, user)
    path = os.path.join(_jf(job_id), "analysis", "mapped_master_file.csv")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Mapped master file not available yet.")
    cols, rows = _read_csv(path)
    return MappingReviewOut(columns=cols, rows=rows)


@router.post("/{job_id}/review/mapping")
def post_mapping(
    job_id: uuid.UUID,
    body: MappingReviewIn,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    _require_gate(job, GateKind.mapping_review)
    path = os.path.join(_jf(job_id), "analysis", "mapped_master_file.csv")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Mapped master file not available yet.")
    if not body.rows:
        raise HTTPException(status_code=422, detail="No rows submitted.")
    # Preserve the original column order; union any new keys at the end.
    existing_cols, _ = _read_csv(path)
    cols = list(existing_cols)
    for r in body.rows:
        for k in r:
            if k not in cols:
                cols.append(k)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=cols, extrasaction="ignore")
    writer.writeheader()
    for r in body.rows:
        writer.writerow({c: r.get(c, "") for c in cols})
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        f.write(buf.getvalue())
    _resume(bg, db, job)
    return {"status": "running", "message": "Saved mapping; resuming from step 8."}


# --------------------------- chart upload gate ------------------------------ #
@router.get("/{job_id}/review/charts", response_model=ChartsReviewOut)
def get_charts(job_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ChartsReviewOut:
    _load_owned(job_id, db, user)
    path = os.path.join(_jf(job_id), "analysis", "failed_charts.json")
    if not os.path.isfile(path):
        return ChartsReviewOut(failed=[])
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return ChartsReviewOut(failed=[FailedChart(**d) for d in data])


@router.post("/{job_id}/review/charts")
async def post_charts(
    job_id: uuid.UUID,
    bg: BackgroundTasks,
    indices: list[int] = Form(...),
    images: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    job = _load_owned(job_id, db, user)
    _require_gate(job, GateKind.chart_upload)
    if len(indices) != len(images):
        raise HTTPException(status_code=422, detail="indices and images count mismatch.")

    import pandas as pd

    jf = _jf(job_id)
    charts_dir = os.path.join(jf, "charts")
    os.makedirs(charts_dir, exist_ok=True)
    csv_path = os.path.join(jf, "analysis", "stocks_with_charts.csv")
    if not os.path.isfile(csv_path):
        raise HTTPException(status_code=404, detail="stocks_with_charts.csv not available yet.")
    df = pd.read_csv(csv_path)
    if "CHART PATH" not in df.columns:
        df["CHART PATH"] = ""
    df["CHART PATH"] = df["CHART PATH"].astype("object")  # avoid float64 dtype clash on assignment

    saved = 0
    for idx, upload in zip(indices, images):
        if upload.content_type not in ALLOWED_IMAGE:
            raise HTTPException(status_code=415, detail=f"Unsupported image type: {upload.content_type}")
        contents = await upload.read()
        if len(contents) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Image exceeds 15 MB limit.")
        if idx < 0 or idx >= len(df):
            raise HTTPException(status_code=422, detail=f"Row index out of range: {idx}")
        ext = os.path.splitext(upload.filename or "")[1].lower() or ".png"
        fname = f"manual_{idx}_{uuid.uuid4().hex[:8]}{ext}"
        with open(os.path.join(charts_dir, fname), "wb") as fh:
            fh.write(contents)
        rel = f"charts/{fname}"
        df.at[idx, "CHART PATH"] = rel
        input_stock = str(df.at[idx, "INPUT STOCK"]) if "INPUT STOCK" in df.columns else str(idx)
        db.add(JobChartUpload(job_id=job.id, input_stock=input_stock, image_path=rel))
        saved += 1

    df.to_csv(csv_path, index=False, encoding="utf-8-sig")
    _resume(bg, db, job)
    return {"status": "running", "uploaded": saved, "message": "Saved chart images; resuming from step 10."}
