# Analyst Rationale Studio

A SEBI-compliance platform for stock-market research-analyst firms. It turns an analyst's daily
media appearance (audio + video link) into a branded, compliant **rationale PDF** that records
every stock recommendation the firm's target analyst made on air — even when the stock name was
spoken only by the host.

## What it does
1. **Media Presence** — log each appearance: platform, channel, video URL (YouTube autofill),
   audio upload, target analyst, "extract all stocks" toggle.
2. **AI Rationale** — a 10-step pipeline: Transcribe (Deepgram) → Translate → Detect Speakers →
   **Extract target analyst's calls** → CSV → Polish → Map to Scrip Master → Fetch CMP →
   Generate Charts → Generate PDF. Three human-review gates along the way.
3. **Saved Rationale** — archive of finished compliance PDFs.

## Tech stack
- Backend: **FastAPI + PostgreSQL** (SQLAlchemy 2, Alembic)
- Frontend: **React + Vite + TypeScript + Tailwind**
- AI: OpenAI / Anthropic / Gemini (admin-selectable per task), Deepgram (transcription)
- Market data: Dhan API (CMP + charts), YouTube Data API v3
- Charts: matplotlib + mplfinance · PDF: reportlab

## Roles
- **Admin**: platforms, API keys, AI model mapping, required files, PDF template, analysts — plus
  everything employees do.
- **Employee**: dashboard, media presence, AI rationale, generate chart, saved rationale, profile.

## How to use these docs (for Claude Code)
Read in this order:
1. `CLAUDE.md` — primary instructions, conventions, definition of done.
2. `docs/01_PRD.md` — requirements & acceptance criteria.
3. `docs/02_ARCHITECTURE.md` — system design, job state machine.
4. `docs/03_DATABASE_SCHEMA.md` — full PostgreSQL schema.
5. `docs/04_BACKEND_API.md` — every endpoint + WebSocket contract.
6. `docs/05_PIPELINE.md` — the 10-step pipeline, gates, resume logic.
7. `docs/06_TOOLS_AND_MODELS.md` — tool convention, AI model management, integrations.
8. `docs/07_FRONTEND_UIUX.md` — design system, navigation, all screens.
9. `docs/08_BUILD_ORDER.md` — **the phased prompt sequence to actually build it**.
10. `docs/09_SETUP.md` — env, deps, skill install, run commands.

Put your existing Python under `docs/reference_code/` (see `docs/09_SETUP.md §8`); Phase 4 ports it.

## Quickstart
See `docs/09_SETUP.md`. TL;DR: `docker compose up -d postgres`, `alembic upgrade head`,
`python -m scripts.seed`, `uvicorn main:app --reload`, then `npm run dev` in `frontend/`.

## Build approach
Follow `docs/08_BUILD_ORDER.md` phase by phase. Get one vertical slice working before expanding.
Commit per phase.
