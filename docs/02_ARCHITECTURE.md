# 02 — Architecture

## 1. High-level

```
┌──────────────┐     HTTPS/REST + WS      ┌───────────────────────────┐
│  React (Vite)│ ───────────────────────▶ │  FastAPI (Uvicorn)        │
│  TS + Tailwind│ ◀─────────────────────── │  api/ · services/ · core/ │
└──────────────┘   JWT auth, live progress └─────────┬─────────────────┘
                                                      │
                          ┌───────────────────────────┼───────────────────────────┐
                          ▼                            ▼                            ▼
                   ┌─────────────┐            ┌──────────────────┐         ┌────────────────┐
                   │ PostgreSQL  │            │ Background Worker │         │ Object storage  │
                   │ (SQLAlchemy)│            │ (job pipeline)    │         │ job_files/ disk │
                   └─────────────┘            └────────┬──────────┘         └────────────────┘
                                                       │ calls tools/
                          ┌────────────────────────────┼────────────────────────────┐
                          ▼              ▼              ▼              ▼               ▼
                     Deepgram      OpenAI/Claude/    Dhan API     YouTube Data    matplotlib/
                                   Gemini                          API v3         reportlab
```

## 2. Process model

- **API process**: serves REST + WebSocket, validates, enqueues jobs, streams progress.
- **Worker**: runs the long pipeline. MVP options (pick one, document choice):
  - *Simple*: FastAPI `BackgroundTasks` + an in-process asyncio task queue (single instance).
  - *Recommended*: **Celery + Redis** (or RQ) so the API stays responsive and jobs survive
    restarts. Use this if you expect concurrent jobs.
- Progress is published to a per-job channel (Redis pub/sub or in-memory) and pushed to the
  client over WebSocket `/ws/jobs/{job_id}`.

## 3. Job orchestration

A single orchestrator (`services/pipeline.py`) drives the 10 steps. Each step:
1. Reads its inputs from `job_files/<job_id>/...` and DB.
2. Loads effective config (`tool_configs` + overrides).
3. Runs the tool's `run(...)`.
4. Writes artifacts + a `job_steps` row (status, started/finished, log tail, output paths).
5. Emits progress events.
6. If the step is a **review gate**, sets job status to `paused_review`, persists, and returns.
   The orchestrator is re-entered (resumed) by a user "submit edits / continue" API call.

### Idempotency & resume
- Each step writes a checkpoint. Re-running a step overwrites its artifacts only.
- `resume(job_id)` computes the next step from `job_steps` and continues.
- `restart(job_id)` clears steps + artifacts and runs from Step 1.

## 4. Job state machine

```
            ┌─────────┐  start    ┌─────────┐
   create ─▶│ pending │ ────────▶ │ running │
            └─────────┘           └────┬────┘
                                       │ reaches gate (step 4/7/9)
                                       ▼
                                 ┌──────────────┐  submit edits / upload
                                 │ paused_review │ ─────────────────────┐
                                 └──────┬────────┘                      │
                                        │ resume                        │
                                        ▼                               │
                                   ┌─────────┐  all steps ok      ┌──────▼────┐
                                   │ running │ ─────────────────▶ │ completed │
                                   └────┬────┘                    └─────┬─────┘
                                        │ error                        │ save / delete
                                        ▼                              ▼
                                   ┌────────┐                   Saved Rationale / discard
                                   │ failed │ (retry step / restart)
                                   └────────┘
```

`gate_kind` on `paused_review`: `extract_review` (after 4), `mapping_review` (after 7),
`chart_upload` (during 9).

## 5. Config resolution (AI models)

```
effective_config(task, job_overrides) =
    DEFAULT_CONFIG[task]                         # in tool schema.py
    ⊕ tool_configs WHERE tool = task             # admin edits
    ⊕ ai_models mapping for task (provider+model) # admin model management
    ⊕ job_overrides                              # per-run tweaks (rare)
```

Provider client is chosen by `ai_models.provider`; a thin `services/ai_router.py` returns the
right client (OpenAI/Anthropic/Gemini) and uses `utils/openai_compat.chat_completion_kwargs`
to normalize params.

## 6. File layout per job

```
backend/job_files/<job_id>/
├── audio/<original_upload>
├── transcripts/transcript.csv | transcript.txt | segments.json | deepgram_raw.json
├── translated.txt
├── speakers.txt
├── extracted.txt                 # Step 4 output (editable at gate)
├── analysis/
│   ├── bulk-input-english.txt    # fed to Step 5
│   ├── bulk-input.csv            # Step 5
│   ├── bulk-input-analysis.csv   # Step 6
│   ├── mapped_master_file.csv    # Step 7 (editable at gate)
│   ├── stocks_with_cmp.csv       # Step 8
│   ├── stocks_with_charts.csv    # Step 9
│   └── failed_charts.json        # Step 9 gate input
├── charts/*.png
└── pdf/<channel>-<date>.pdf
```

> Step 4 output text is what Step 5's parser consumes. The orchestrator writes the (possibly
> user-edited) extracted text to `analysis/bulk-input-english.txt` before running Step 5.

## 7. Security architecture

- JWT access (short) + refresh (httpOnly cookie). `core/security.py`.
- Route deps: `get_current_user`, `require_admin`.
- API keys encrypted at rest with a Fernet key from env (`APP_ENCRYPTION_KEY`); decrypted only
  when a tool needs them. Never returned in plaintext to the client except via explicit
  admin "reveal" with re-auth.
- File uploads: validated content-type + size; stored outside web root; served via signed URLs.

## 8. External integrations (see docs/06)

- **Deepgram** SDK v7 — transcription.
- **OpenAI / Anthropic / Gemini** — translate, speaker-detect, extract, polish.
- **Dhan API** — `/v2/charts/intraday`, `/v2/charts/historical` for CMP + charts.
- **YouTube Data API v3** — video metadata autofill.

## 9. Deployment (dev)

`docker-compose.yml`: `postgres`, `redis` (if Celery), `backend`, `frontend`. Volumes for
`job_files/` and Postgres data. Production hardening is out of MVP scope but keep 12-factor.
