"""Structured per-job / per-step logging (docs/02 §7).

Each job gets a logger that writes structured records (with job + step fields)
to stderr and to job_files/<job_id>/pipeline.log, so a run can be audited after
the fact independently of the live WS stream.
"""
from __future__ import annotations

import logging
import os

from core.config import settings

_FMT = logging.Formatter("%(asctime)s %(levelname)s job=%(job)s step=%(step)s %(message)s")


def get_job_logger(job_id) -> logging.Logger:
    lg = logging.getLogger(f"pipeline.{job_id}")
    if not lg.handlers:
        lg.setLevel(logging.INFO)
        lg.propagate = False
        try:
            jf = os.path.join(settings.JOB_FILES_DIR, str(job_id))
            os.makedirs(jf, exist_ok=True)
            fh = logging.FileHandler(os.path.join(jf, "pipeline.log"), encoding="utf-8")
            fh.setFormatter(_FMT)
            lg.addHandler(fh)
        except OSError:
            pass
        sh = logging.StreamHandler()  # stderr — kept off the stdout WS stream
        sh.setFormatter(_FMT)
        lg.addHandler(sh)
    return lg


def jlog(job_id, step, event: str, level: int = logging.INFO, **fields) -> None:
    extra = {"job": str(job_id), "step": step if step is not None else "-"}
    msg = f"event={event}" + "".join(f" {k}={v}" for k, v in fields.items())
    get_job_logger(job_id).log(level, msg, extra=extra)
