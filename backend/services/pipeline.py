"""Rationale pipeline orchestrator (docs/05).

Drives the 10 steps for one job: runs each tool, persists a `job_steps` row,
streams emoji logs to the progress hub, and halts at the review gates
(extract_review after 4, mapping_review after 7, conditional chart_upload in 9).
Runs in a worker thread via FastAPI BackgroundTasks; owns its own DB session.

Steps are dispatched through STEP_ADAPTERS (module-level) so the state machine
can be exercised in isolation. Each adapter is called with (job, db, cfg) where
cfg = effective_config_for(step, job) and does the file IO around a tool's run().

The worker boundary is deliberately thin (run_pipeline / resume / restart /
retry_step are plain callables) so it can move from BackgroundTasks to a
Celery/RQ task later without touching the state-machine logic.
"""
from __future__ import annotations

import contextlib
import logging
import datetime as dt
import os
import shutil
import sys
import traceback

from sqlalchemy import delete, select, update

from core.config import settings
from db.enums import GateKind, JobStatus, StepStatus
from db.models import Analyst, Job, JobAnalyst, JobStep, UploadedFile
from db.session import SessionLocal
from services.progress_hub import hub
from utils.job_logging import jlog
from utils.path_utils import resolve_uploaded_file_path

STEP_KEYS = {
    1: "transcribe", 2: "translate", 3: "speaker_detect", 4: "extract",
    5: "convert_csv", 6: "polish", 7: "map_master", 8: "fetch_cmp",
    9: "generate_charts", 10: "generate_pdf",
}
GATES = {4: GateKind.extract_review, 7: GateKind.mapping_review}
ANALYST_STEPS = {3, 4}          # steps that target the selected analyst(s)
DATETIME_STEPS = {5, 9}         # steps that need the job's call date/time
LAST_STEP = 10


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def job_folder(job_id) -> str:
    return os.path.join(settings.JOB_FILES_DIR, str(job_id))


_STEP_ARTIFACTS = {
    1: ["transcripts"], 2: ["translated.txt"], 3: ["speakers.txt"],
    4: ["extracted.txt", "bulk-input-english.txt"],
    5: ["analysis/bulk-input.csv"], 6: ["analysis/bulk-input-analysis.csv"],
    7: ["analysis/mapped_master_file.csv"], 8: ["analysis/stocks_with_cmp.csv"],
    9: ["analysis/stocks_with_charts.csv", "analysis/failed_charts.json", "charts"],
    10: ["pdf"],
}


def _clear_artifacts_from(job_id, start_step: int) -> None:
    """Remove on-disk outputs for start_step..10 so reruns don't show stale data."""
    jf = job_folder(job_id)
    for n in range(start_step, LAST_STEP + 1):
        for rel in _STEP_ARTIFACTS.get(n, []):
            path = os.path.join(jf, rel)
            with contextlib.suppress(OSError):
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                elif os.path.isfile(path):
                    os.remove(path)


def _resolve_audio_path(job, uf) -> str | None:
    """Find the job's audio on disk regardless of how the path was stored.

    Audio lives under job_files/<job_id>/audio/. The stored file_path may be
    absolute (new jobs) or relative (older jobs); resolve_uploaded_file_path is
    only correct for /uploads/ files, so we try several candidates here.
    """
    if not uf or not uf.file_path:
        return None
    fp = uf.file_path
    adir = os.path.join(job_folder(job.id), "audio")
    candidates = [fp, os.path.abspath(fp)]
    base = os.path.basename(fp)
    if base:
        candidates.append(os.path.join(adir, base))
    resolved = resolve_uploaded_file_path(fp)
    if resolved:
        candidates.append(resolved)
    if os.path.isdir(adir):
        candidates += [os.path.join(adir, f) for f in sorted(os.listdir(adir))]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _analyst_overrides(job: Job, db) -> dict:
    """Target-analyst context for the AI steps.

    A job may target several analysts (job_analysts). Their names join into the
    target label and all their aliases are unioned. When extract_all_stocks is
    set, targeting is disabled so every analyst's calls are extracted.
    """
    if job.extract_all_stocks:
        return {"target_analyst_name": "", "aliases": ""}
    rows = db.scalars(select(JobAnalyst).where(JobAnalyst.job_id == job.id)).all()
    analysts = [a for a in (db.get(Analyst, r.analyst_id) for r in rows) if a]
    if not analysts:
        return {"target_analyst_name": "", "aliases": ""}
    names = [a.name for a in analysts if a.name]
    aliases = ", ".join(a.aliases for a in analysts if a.aliases)
    return {"target_analyst_name": "; ".join(names), "aliases": aliases}


def _call_date(job: Job) -> str:
    return job.video_date.isoformat() if job.video_date else ""


def _call_time(job: Job) -> str:
    return job.video_time.strftime("%H:%M:%S") if job.video_time else "15:30:00"


def effective_config_for(n: int, job: Job, db) -> dict:
    """Per-step effective configuration (docs/02 §5).

    The tool's own get_effective_config layers DEFAULT_CONFIG ⊕ tool_configs, and
    ai_router.resolve_model layers the ai_models provider/model mapping. This
    function adds the remaining layer — per-job context — which is passed to the
    tool as overrides: target analyst name/aliases for the AI targeting steps,
    and the job's call date/time for the steps that need them.
    """
    cfg: dict = {"call_date": _call_date(job), "call_time": _call_time(job)}
    if n in ANALYST_STEPS:
        cfg.update(_analyst_overrides(job, db))
    return cfg


def _emit(job_id, event: dict) -> None:
    hub.publish(job_id, event)


class _Tee:
    """Tee stdout: mirror to the real stream and stream lines as log events."""

    def __init__(self, job_id, step_no: int, real):
        self.job_id, self.step_no, self.real = job_id, step_no, real
        self._buf = ""
        self.lines: list[str] = []

    def write(self, s: str) -> int:
        self.real.write(s)
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line.strip():
                self.lines.append(line)
                _emit(self.job_id, {"type": "log", "step_no": self.step_no, "line": line})
        return len(s)

    def flush(self) -> None:
        self.real.flush()

    def tail(self, n: int = 40) -> str:
        return "\n".join(self.lines[-n:])


@contextlib.contextmanager
def _capture(job_id, step_no: int):
    tee = _Tee(job_id, step_no, sys.stdout)
    old = sys.stdout
    sys.stdout = tee
    try:
        yield tee
    finally:
        sys.stdout = old


def _upsert_step(db, job_id, step_no, status, *, log_tail=None, error=None,
                 output_paths=None, started=False, finished=False) -> None:
    row = db.scalar(select(JobStep).where(JobStep.job_id == job_id, JobStep.step_no == step_no))
    if row is None:
        row = JobStep(job_id=job_id, step_no=step_no, step_key=STEP_KEYS[step_no], status=status)
        db.add(row)
    row.status = status
    row.step_key = STEP_KEYS[step_no]
    if log_tail is not None:
        row.log_tail = log_tail
    if error is not None:
        row.error = error
    if output_paths is not None:
        row.output_paths = output_paths
    if started:
        row.started_at = dt.datetime.now(dt.timezone.utc)
        row.error = None
    if finished:
        row.finished_at = dt.datetime.now(dt.timezone.utc)
    db.commit()


# --------------------------------------------------------------------------- #
# Step adapters — each: (job, db, cfg) -> result dict
# --------------------------------------------------------------------------- #
def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _write(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _step_transcribe(job, db, cfg) -> dict:
    from tools.step01_transcribe import runtime as t
    if not job.audio_file_id:
        raise RuntimeError("No audio uploaded for this job.")
    uf = db.get(UploadedFile, job.audio_file_id)
    audio_path = _resolve_audio_path(job, uf)
    if not audio_path:
        raise RuntimeError("Audio file is missing on disk.")
    t.run(str(job.id), audio_path)
    return {"output_paths": {"transcript": os.path.join(job_folder(job.id), "transcripts", "transcript.txt")}}


def _step_translate(job, db, cfg) -> dict:
    from tools.step02_translate import runtime as t
    jf = job_folder(job.id)
    res = t.run(text=_read(os.path.join(jf, "transcripts", "transcript.txt")))
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Translation failed")
    out = os.path.join(jf, "translated.txt")
    _write(out, res["text"])
    return {"output_paths": {"translated": out}, "skipped": res.get("skipped", False)}


def _step_speakers(job, db, cfg) -> dict:
    from tools.step03_detect_speakers import runtime as t
    jf = job_folder(job.id)
    res = t.run(_read(os.path.join(jf, "translated.txt")), overrides=cfg)
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Speaker detection failed")
    out = os.path.join(jf, "speakers.txt")
    _write(out, res["text"])
    return {"output_paths": {"speakers": out}}


def _step_extract(job, db, cfg) -> dict:
    from tools.step04_extract_analysis import runtime as t
    jf = job_folder(job.id)
    res = t.run(_read(os.path.join(jf, "speakers.txt")), overrides=cfg)
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Extraction failed")
    extracted = res["arranged_text"]
    _write(os.path.join(jf, "extracted.txt"), extracted)
    # Default the Step-5 input; the review gate may overwrite this on submit.
    _write(os.path.join(jf, "bulk-input-english.txt"), extracted)
    return {"output_paths": {"extracted": os.path.join(jf, "extracted.txt")}}


def _step_convert_csv(job, db, cfg) -> dict:
    from tools.step05_convert_csv import runtime as t
    res = t.run(job_folder(job.id), cfg["call_date"], cfg["call_time"])
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "CSV conversion failed")
    return {"output_paths": {"bulk_input": res.get("output_file")}}


def _step_polish(job, db, cfg) -> dict:
    from tools.step06_polish import runtime as t
    res = t.run(job_folder(job.id))
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Polish failed")
    return {"output_paths": {"polished": res.get("output_file")}}


def _step_map_master(job, db, cfg) -> dict:
    from tools.step07_map_master import runtime as t
    res = t.run(job_folder(job.id))
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Master mapping failed")
    return {"output_paths": {"mapped": res.get("output_file")}}


def _step_fetch_cmp(job, db, cfg) -> dict:
    from tools.step08_fetch_cmp import runtime as t
    res = t.run(job_folder(job.id))
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "CMP fetch failed")
    return {"output_paths": {"cmp": res.get("output_file")}}


def _step_charts(job, db, cfg) -> dict:
    from tools.step09_generate_charts import runtime as t
    res = t.run(job_folder(job.id), cfg["call_date"], cfg["call_time"])
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "Chart generation failed")
    return {"output_paths": {"charts": res.get("output_file")},
            "failed_count": int(res.get("failed_count", 0))}


def _step_pdf(job, db, cfg) -> dict:
    from tools.step10_generate_pdf import runtime as t
    res = t.run(job_folder(job.id))
    if not res.get("success"):
        raise RuntimeError(res.get("error") or "PDF generation failed")
    return {"output_paths": {"pdf": res.get("output_file")}, "output_file": res.get("output_file")}


STEP_ADAPTERS = {
    1: _step_transcribe, 2: _step_translate, 3: _step_speakers, 4: _step_extract,
    5: _step_convert_csv, 6: _step_polish, 7: _step_map_master, 8: _step_fetch_cmp,
    9: _step_charts, 10: _step_pdf,
}


# --------------------------------------------------------------------------- #
# State machine
# --------------------------------------------------------------------------- #
def _pause(db, job, gate: GateKind, next_step: int) -> None:
    job.status = JobStatus.paused_review
    job.gate = gate
    job.current_step = next_step
    db.commit()
    jlog(job.id, next_step - 1, "paused_gate", gate=gate.value, next_step=next_step)
    _emit(job.id, {"type": "gate", "gate": gate.value, "next_step": next_step})
    from services.notifications import notify
    notify(db, job.created_by, job.id, "review",
           f"Review needed: {job.title or 'a job'}",
           f"Paused at step {next_step - 1} for your review.")


def run_pipeline(job_id, start_step: int = 1) -> None:
    """Run steps start_step..10, persisting progress and halting at gates."""
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        job.status = JobStatus.running
        job.gate = GateKind.none
        job.error_message = None
        db.commit()
        jlog(job_id, None, "pipeline_start", start_step=start_step)

        # Reset this step and every later one so stale done-ticks/outputs clear
        # immediately (a reload should look like a fresh run from this point).
        db.execute(
            update(JobStep)
            .where(JobStep.job_id == job_id, JobStep.step_no >= start_step)
            .values(status=StepStatus.pending, log_tail=None, error=None,
                    output_paths=None, started_at=None, finished_at=None)
        )
        db.commit()
        _clear_artifacts_from(job_id, start_step)
        _emit(job_id, {"type": "step", "step_no": start_step, "step_key": STEP_KEYS[start_step], "status": "reset"})

        for n in range(start_step, LAST_STEP + 1):
            job.current_step = n
            db.commit()
            _emit(job_id, {"type": "step", "step_no": n, "step_key": STEP_KEYS[n], "status": "running"})
            _upsert_step(db, job_id, n, StepStatus.running, started=True)
            jlog(job_id, n, "step_start", key=STEP_KEYS[n])

            try:
                cfg = effective_config_for(n, job, db)
                with _capture(job_id, n) as tee:
                    result = STEP_ADAPTERS[n](job, db, cfg)
                db.refresh(job)
            except Exception as exc:  # noqa: BLE001
                tail = locals().get("tee").tail() if locals().get("tee") else ""
                msg = f"{type(exc).__name__}: {exc}"
                traceback.print_exc()
                db.refresh(job)
                _upsert_step(db, job_id, n, StepStatus.failed, log_tail=tail, error=msg, finished=True)
                job.status = JobStatus.failed
                job.error_message = msg
                db.commit()
                jlog(job_id, n, "step_failed", level=logging.ERROR, key=STEP_KEYS[n], error=type(exc).__name__)
                _emit(job_id, {"type": "error", "step_no": n, "message": msg})
                from services.notifications import notify
                notify(db, job.created_by, job_id, "failed",
                       f"Job failed: {job.title or 'a job'}",
                       f"Failed at step {n} — {STEP_KEYS[n]}.")
                return

            _upsert_step(db, job_id, n, StepStatus.done, log_tail=tee.tail(),
                         output_paths=result.get("output_paths"), finished=True)
            _emit(job_id, {"type": "step", "step_no": n, "step_key": STEP_KEYS[n], "status": "done"})
            jlog(job_id, n, "step_done", key=STEP_KEYS[n])

            if n in GATES:
                _pause(db, job, GATES[n], next_step=n + 1)
                return
            if n == 9 and result.get("failed_count", 0) > 0:
                _pause(db, job, GateKind.chart_upload, next_step=10)
                return

        # All steps complete.
        job.status = JobStatus.completed
        job.gate = GateKind.none
        job.current_step = LAST_STEP
        last = db.scalar(select(JobStep).where(JobStep.job_id == job_id, JobStep.step_no == LAST_STEP))
        if last and last.output_paths:
            job.output_pdf_path = last.output_paths.get("pdf")
        db.commit()
        jlog(job_id, LAST_STEP, "pipeline_completed", pdf=bool(job.output_pdf_path))
        _emit(job_id, {"type": "done", "status": "completed",
                       "pdf_url": f"/api/jobs/{job_id}/pdf" if job.output_pdf_path else None})
        from services.notifications import notify
        notify(db, job.created_by, job_id, "completed",
               f"Rationale ready: {job.title or 'a job'}",
               "The pipeline finished and the PDF is ready.")


def resume(job_id) -> None:
    """Continue after a gate submission (current_step holds the next step)."""
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        start = max(1, job.current_step or 1)
    run_pipeline(job_id, start_step=start)


def restart(job_id) -> None:
    """Clear all steps + derived artifacts and run from Step 1 (keeps audio)."""
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if job is None:
            return
        db.execute(delete(JobStep).where(JobStep.job_id == job_id))
        job.status = JobStatus.pending
        job.gate = GateKind.none
        job.current_step = 0
        job.error_message = None
        job.output_pdf_path = None
        db.commit()
    # Wipe derived artifacts (transcripts/, analysis/, charts/, pdf/, *.txt) but keep audio.
    jf = job_folder(job_id)
    for name in ("transcripts", "analysis", "charts", "pdf"):
        shutil.rmtree(os.path.join(jf, name), ignore_errors=True)
    if os.path.isdir(jf):
        for fn in os.listdir(jf):
            if fn.endswith(".txt"):
                with contextlib.suppress(OSError):
                    os.remove(os.path.join(jf, fn))
    hub.clear(job_id)
    run_pipeline(job_id, start_step=1)


def retry_step(job_id, step_no: int) -> None:
    """Re-run the pipeline from a specific step (idempotent overwrite)."""
    run_pipeline(job_id, start_step=max(1, int(step_no)))
