# 08 — Build Order (Prompt Sequence for Claude Code)

Build in phases. **Finish, run, and verify each phase before the next.** After every phase:
commit with a clear message. Copy each "PROMPT" block to Claude Code as a task. Adjust as needed.

---

## Phase 0 — Scaffold & infra
**PROMPT:** "Read CLAUDE.md and docs/02, docs/09. Scaffold the monorepo: `backend/` (FastAPI,
SQLAlchemy 2, Alembic, Pydantic v2, uvicorn) and `frontend/` (Vite + React + TS + Tailwind +
TanStack Query + Zustand + react-router + framer-motion). Add `docker-compose.yml` with
postgres (+ redis if we use Celery). Set up `core/config.py` (env: DATABASE_URL, JWT_SECRET,
APP_ENCRYPTION_KEY), health check `/api/health`, and a working `npm run dev` + `uvicorn` dev
flow. No features yet."
**Verify:** both servers boot; health check returns ok; frontend renders a blank shell.

## Phase 1 — Database & migrations
**PROMPT:** "Read docs/03. Create all SQLAlchemy models and the initial Alembic migration to
match the DDL exactly (enums, extensions citext/pgcrypto, indexes). Add a seed script: one admin
user (from env), `model_settings` row, default `ai_models` rows for the 4 tasks, and
`tool_configs` lazily-created. Provide `make migrate` / `make seed`."
**Verify:** migration applies cleanly; tables match schema; admin user seeded.

## Phase 2 — Auth, roles, profile
**PROMPT:** "Read docs/04 (auth, users) and CLAUDE.md §6. Implement JWT auth (access + httpOnly
refresh), bcrypt, `core/security.py`, deps `get_current_user`/`require_admin`. Endpoints:
login/refresh/logout/me, profile update, avatar upload, change password, admin user CRUD.
Frontend: login screen, app shell with role-aware sidebar (docs/07 §2), Manage Profile screen,
auth store + protected routes. Use the UI/UX Pro Max skill for styling."
**Verify:** login works for admin + employee; employee cannot see/admin routes 403; profile +
password change + avatar work.

## Phase 3 — Admin configuration suite
Build these one screen at a time (each its own commit). Read docs/04, docs/06, docs/07 §9.
1. **Manage API Keys** (+ `core/crypto.py` Fernet, encrypt on save, test-connection per provider).
2. **Manage Platform** (animated Add modal, icon picker, logo upload, soft delete).
3. **Analysts Profile** (aliases chips, avatar).
4. **Upload Required Files** (master CSV validation, company logo, fonts).
5. **PDF Template** (rich text editors).
6. **Manage AI Models** (per-task provider/model + advanced config from tool schema; global
   fallback). Requires `tool_configs` + `ai_models` endpoints.
**Verify:** each persists and round-trips; keys masked + reveal + test; master file validates.

## Phase 4 — Pipeline tools (no orchestration yet)
**PROMPT:** "Read docs/05, docs/06 and the reference code in docs/reference_code/. Create the
tool folders under `backend/tools/` following the convention (schema.py + runtime.py + __init__).
Port the reference code for: deepgram_transcriber, speaker_detector, extract_stocks_analysis,
bulk/convert_csv, bulk/polish, bulk/map_master, bulk/fetch_cmp, bulk/charts, bulk/pdf. Create the
new `translator` tool. Refactor all AI tools to call `services/ai_router.chat(...)` instead of
the OpenAI SDK directly, so provider is admin-selectable; keep prompts, chunking, refusal
detection, and `_normalise_blocks` intact. Recreate the `utils/` helpers (docs/06 §9). Add unit
tests for pure logic (csv parse, symbol clean, master match, date/time normalize)."
**Verify:** each tool's `run(...)` works on a sample input in isolation; tests pass.

## Phase 5 — Integrations
**PROMPT:** "Read docs/06 §5–6. Implement `services/youtube.py` (Data API v3 metadata) and
`services/dhan.py` (CMP + charts with retry/backoff, IST handling). Wire keys from `api_keys`
(decrypted). Add `GET /youtube/metadata` and the standalone `POST /tools/generate-chart`."
**Verify:** YouTube autofill returns correct fields; generate-chart produces a PNG.

## Phase 6 — Media Presence
**PROMPT:** "Read docs/04 (jobs) and docs/07 §5. Implement job create (multipart w/ audio +
metadata), list, detail, edit, delete. Frontend Media Presence: Add Entry flow with YouTube
autofill + audio upload + analyst select + extract-all toggle; list view with status chips, play
popup, PDF download, actions, and 'Start making rationale'."
**Verify:** can create a `pending` job from audio + metadata; list renders; play/edit/delete work.

## Phase 7 — Orchestrator + worker + progress
**PROMPT:** "Read docs/02 §2–4 and docs/05. Implement `services/pipeline.py` orchestrator with
the job state machine, `job_steps` persistence, idempotent steps, gates after 4 and 7 and the
conditional chart gate in 9. Run it in a background worker (BackgroundTasks for MVP, or
Celery+Redis if configured). Stream progress over `WS /ws/jobs/{id}` with polling fallback.
Endpoints: start/restart/resume/retry-step/steps/artifact/pdf/save. Do NOT include the review
gate UIs yet — pause and expose gate state."
**Verify:** a job runs steps 1→4 then pauses at extract_review; logs stream live; restart works.

## Phase 8 — Work page + review gates
**PROMPT:** "Read docs/07 §6 and docs/04 review-gate endpoints. Build the AI Rationale work page:
stepper, live log stream, artifact preview, and the three review gates (extract textarea,
mapping editable grid, chart-upload dropzones). Implement the review GET/POST endpoints that
write edited artifacts and resume the pipeline. Ensure the page rebuilds correct state on refresh
and reconnects WS."
**Verify:** full run end-to-end through both gates (+ chart gate when Dhan fails); edits persist
and affect downstream output.

## Phase 9 — PDF finalize, Save/Delete, Saved Rationale
**PROMPT:** "Read docs/05 Step 10, docs/07 §8. Ensure Step 10 produces the branded PDF matching
the reference design from pdf_template/channels/uploaded_files/job. On completion show
Save/Delete. Implement Saved Rationale list + download + delete."
**Verify:** generated PDF matches reference layout; saved jobs appear in archive with working
download.

## Phase 10 — Generate Chart screen + polish
**PROMPT:** "Read docs/07 §7. Build the standalone Generate Chart screen on top of
`/tools/generate-chart`. Then do a UX pass with the UI/UX Pro Max skill: loading/empty/error
states everywhere, toasts, animations, responsive checks, accessibility. Add the Dashboard
(docs/07 §4)."
**Verify:** chart tool works standalone; dashboard shows real counts; app feels cohesive.

## Phase 11 — Hardening
**PROMPT:** "Add input validation everywhere, rate-limit auth + AI-test endpoints, signed
download URLs, structured logging per job/step, error boundaries (frontend), and a basic e2e
happy-path test. Write `README.md` run instructions."
**Verify:** the Definition of Done checklist in CLAUDE.md §8 passes.

---

## Working agreement reminders for Claude Code
- One vertical slice at a time; run it before expanding.
- Reuse `utils/` + reference code; don't reinvent working logic.
- Ask before adding deps or changing the DB schema.
- Keep secrets in DB (api_keys) / env (infra), never in source.
- Commit per phase/sub-task with descriptive messages.
