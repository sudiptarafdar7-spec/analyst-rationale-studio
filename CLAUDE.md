# CLAUDE.md — Analyst Rationale Studio

> This is the **primary instruction file** for Claude Code. Read this first, every session.
> The full specs live in `/docs`. Always consult the relevant doc before writing code.

---

## 1. What we are building

**Analyst Rationale Studio** is a SEBI-compliance platform for stock-market research-analyst
firms. SEBI requires every registered Research Analyst to record, every day, every stock
recommendation they make on TV / media / social channels, and archive it as a PDF.

A firm has **multiple analysts**. They appear daily on media shows (YouTube, Facebook, etc.)
alongside a host and 4–5 analysts from *other* firms. The host asks each analyst about
stocks one by one. **Our job: extract ONLY our target analyst's stock calls** from that
show, attach the correct stock name (often spoken by the host, not the analyst), and produce
a branded compliance PDF.

Example: Host: *"Pradip ji, your view on Reliance?"* → Pradip: *"Hold for 2 months, stoploss
1250, target 1475+."* The analyst never said "Reliance", but the call must be captured as
**Reliance → {analysis}**.

### The core flow (user's mental model)
1. **Media Presence** — user logs each media appearance (platform, channel, video URL, audio
   upload, target analyst, "extract all stocks" flag).
2. **AI Rationale** — a 10-step pipeline turns the audio into a compliance PDF.
3. **Saved Rationale** — finished PDFs are archived.

---

## 2. Tech stack (FIXED — do not substitute)

| Layer     | Choice                                                    |
|-----------|-----------------------------------------------------------|
| Backend   | **Python 3.11+, FastAPI**, Uvicorn                        |
| DB        | **PostgreSQL** (psycopg2 / SQLAlchemy 2.x, Alembic migrations) |
| Auth      | JWT (access + refresh), bcrypt password hashing           |
| Frontend  | **React 18 + Vite + TypeScript + TailwindCSS**            |
| State/data| TanStack Query (server state) + Zustand (UI state)        |
| Realtime  | WebSocket (pipeline progress) — fallback to SSE/polling   |
| AI        | OpenAI, Anthropic, Gemini (admin-selectable), Deepgram    |
| Market    | Dhan API (CMP + charts), YouTube Data API v3              |
| Charts    | matplotlib + mplfinance (server-side PNG)                 |
| PDF       | reportlab                                                 |

The reference code in `/docs/reference_code/` (the user's existing Python) is **canonical**
for the pipeline tools. Match its conventions exactly. Do not rewrite working logic.

---

## 3. Repository layout (target)

```
analyst-rationale-studio/
├── CLAUDE.md
├── docs/                      # all specs — READ THESE
├── backend/
│   ├── main.py                # FastAPI app entrypoint
│   ├── api/                   # routers (auth, users, platforms, keys, models, jobs, …)
│   ├── core/                  # config, security, deps, settings
│   ├── db/                    # session, base, models (SQLAlchemy)
│   ├── schemas/               # Pydantic request/response models
│   ├── services/              # business logic (job orchestration, youtube, dhan)
│   ├── tools/                 # PIPELINE TOOLS — one folder per tool (see §5)
│   │   ├── deepgram_transcriber/
│   │   ├── translator/
│   │   ├── speaker_detector/
│   │   ├── extract_stocks_analysis/
│   │   └── bulk/              # csv, polish, map_master, fetch_cmp, charts, pdf
│   ├── utils/                 # database, openai_config, openai_compat, path_utils, …
│   ├── migrations/            # Alembic
│   └── job_files/<job_id>/    # per-job artifacts (transcripts/, analysis/, charts/, pdf/)
├── frontend/
│   ├── src/
│   │   ├── app/               # router, providers
│   │   ├── pages/             # route pages
│   │   ├── components/        # reusable UI
│   │   ├── features/          # feature modules (media-presence, rationale, admin, …)
│   │   ├── lib/               # api client, ws client, auth
│   │   └── styles/
└── docker-compose.yml         # postgres + backend + frontend (dev)
```

---

## 4. The 10-step pipeline (authoritative summary — full spec in `docs/05_PIPELINE.md`)

| # | Step             | Engine (admin-selectable)        | Output                          | Pause? |
|---|------------------|----------------------------------|---------------------------------|--------|
| 1 | Transcribe       | Deepgram                         | transcript.csv/.txt/segments.json | no   |
| 2 | Translate→EN     | GPT/Claude/Gemini                | translated transcript           | no     |
| 3 | Detect Speakers  | GPT/Claude/Gemini                | speaker-labelled transcript     | no     |
| 4 | Extract Analysis | GPT/Claude/Gemini                | target analyst's stock calls    | **YES — user reviews/edits** |
| 5 | Convert to CSV   | deterministic parser             | bulk-input.csv                  | no     |
| 6 | Polish Analysis  | GPT/Claude/Gemini                | bulk-input-analysis.csv         | no     |
| 7 | Map Master File  | deterministic fuzzy match        | mapped_master_file.csv          | **YES — user edits CSV** |
| 8 | Fetch CMP        | Dhan API                         | stocks_with_cmp.csv             | no     |
| 9 | Generate Charts  | Dhan API + mplfinance            | charts/*.png + stocks_with_charts.csv | **PAUSE per failed chart — user uploads image** |
| 10| Generate PDF     | reportlab                        | pdf/<channel>-<date>.pdf        | no → then Save/Delete |

**Pauses are first-class.** A job has a status machine; the pipeline halts at review gates,
persists state, and resumes when the user submits edits. Never run the whole pipeline blindly.

---

## 5. Tool convention (MUST follow — derived from reference code)

Every pipeline tool is a self-contained folder:

```
backend/tools/<tool_name>/
├── __init__.py        # public contract: exposes run(...)
├── schema.py          # DEFAULT_CONFIG + get_effective_config(overrides) + JSON schema for admin UI
└── runtime.py         # the actual work; pulls every option from get_effective_config()
```

- **Every option** (model, language, temperature, prompts, chunk sizes…) is admin-editable
  config stored in the `tool_configs` DB table, merged with per-job `overrides`.
- `get_effective_config(overrides)` = `DEFAULT_CONFIG` ⊕ DB row ⊕ overrides.
- AI model selection flows through `utils/openai_config.get_model()` /
  `model_settings` and the `ai_models` table. **Never hardcode a model.**
- `utils/openai_compat.chat_completion_kwargs(model, max_tokens, temperature)` normalizes
  params across providers (e.g. reasoning models). Reuse it.
- Tools print progress with the existing emoji-log style; route those logs to the job's
  progress stream (WebSocket) as well as stdout.

The user has supplied working code for: Deepgram transcribe, speaker detect, extract stocks,
csv convert, polish, map master, fetch CMP, charts, PDF. **Adapt, don't reinvent.** Wrap each
into the tool convention and wire to the orchestrator.

---

## 6. Roles & access

- **admin**: everything employees can do **plus** the admin menus: Manage Platform,
  Manage API Keys, Manage AI Models, Upload Required Files, PDF Template, Analysts Profile.
- **employee**: Dashboard, Media Presence, AI Rationale, Generate Chart, Saved Rationale,
  Manage Profile.
- Enforce on **both** backend (route deps `require_admin`) and frontend (route guards + hidden
  menus). Backend is the source of truth — never trust the client.

---

## 7. Working rules for Claude Code

1. **Read the relevant `/docs` file before coding a feature.** Build order is `docs/08_BUILD_ORDER.md`.
2. Build in the phase order. Do **not** scaffold everything at once — get one vertical slice
   working (auth → DB → one screen) before expanding.
3. After each phase: run it, show me it works, commit. Small commits, clear messages.
4. Keep secrets out of code. API keys live in the `api_keys` table (admin-managed), never `.env`
   except `DATABASE_URL`, `JWT_SECRET`, and dev infra.
5. Match existing code style in `docs/reference_code/`. Reuse `utils/` helpers.
6. Use the **UI/UX Pro Max skill** for all frontend design work (install steps in `docs/09_SETUP.md`).
   Every screen should look intentional and polished, not a default template.
7. Validate everything with Pydantic (backend) and zod (frontend).
8. Long-running work (the pipeline) runs in a **background worker**, not in the request thread.
9. Write a short test for each pipeline step's pure logic (parsing, normalization, matching).
10. When unsure, ask me before introducing a new dependency or changing the schema.

---

## 8. Definition of done (MVP)

- [ ] Email/password login, JWT, two roles, profile + avatar + password change.
- [ ] Admin: platforms, API keys, AI model mapping, required-file uploads, PDF template, analysts.
- [ ] Media Presence: add entry with YouTube autofill, audio upload, target analyst, list view
      with status, play popup, edit/delete/restart.
- [ ] AI Rationale: full 10-step pipeline with live progress page and the 3 review gates.
- [ ] Chart fallback upload when Dhan returns no data.
- [ ] PDF matches the reference design (letterhead, charts, rationale, disclaimer, contacts).
- [ ] Saved Rationale archive with download.
- [ ] Generate Chart standalone tool.

See `docs/01_PRD.md` for acceptance detail.
