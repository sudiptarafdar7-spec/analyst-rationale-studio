# Analyst Rationale Studio

A SEBI-compliance platform for stock-market research-analyst firms. It turns an
analyst's media appearance (audio + video link) into a branded compliance PDF via
a resumable 10-step AI pipeline with human review gates.

- **Backend:** Python 3.11+, FastAPI, PostgreSQL (SQLAlchemy 2 + Alembic), JWT auth.
- **Frontend:** React 18 + Vite + TypeScript + TailwindCSS + TanStack Query + Zustand.
- **Pipeline:** Deepgram (transcribe) → translate → detect speakers → extract →
  CSV → polish → map master → fetch CMP → charts → PDF, with review gates after
  steps 4 and 7 and a conditional chart-upload gate in step 9.

## Prerequisites

- Python 3.11+ and `pip`
- Node.js 18+ and `npm`
- PostgreSQL 14+ running locally (with the `citext` and `pgcrypto` extensions available)

## 1. Database

Create a database (default name `ars`):

```bash
createdb ars
```

## 2. Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create `backend/.env` (or repo-root `.env`):

```
DATABASE_URL=postgresql+psycopg2://<user>:<password>@localhost:5432/ars
JWT_SECRET=<a-long-random-string>
APP_ENCRYPTION_KEY=<fernet-key>          # python -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

Apply migrations and seed the first admin (the app also self-heals the schema on
startup, but running migrations explicitly is recommended):

```bash
alembic upgrade head
python scripts/seed.py                    # creates the admin user + default config
uvicorn main:app --reload                 # http://localhost:8000  (docs at /docs)
```

## 3. Frontend

```bash
cd frontend
npm install                               # installs deps incl. recharts
npm run dev                               # http://localhost:5173 (proxies /api, /uploads, /ws -> :8000)
```

Open http://localhost:5173 and sign in with the seeded admin credentials.

## 4. Configure integrations (admin)

API keys are **not** stored in code or `.env` — add them in the UI under
**Manage API Keys** (encrypted at rest): OpenAI / Anthropic / Gemini, Deepgram,
Dhan, and YouTube. Then set per-task models under **Manage AI Models**, upload the
scrip master CSV + company logo/fonts under **Upload Required Files**, and fill the
**PDF Template**. Without these, pipeline steps that call external services will
fail gracefully with a clear error.

## 5. Typical flow

1. **Media Presence** → add an appearance (platform, channel, video URL with
   "Fetch details" autofill, audio upload, target analysts).
2. **Start making rationale** → opens the **AI Rationale** work page: live step
   progress over WebSocket, with three review gates (edit extracted calls, fix the
   stock mapping, upload any missing charts).
3. On completion, preview the branded PDF and **Save** it.
4. **Saved Rationale** → searchable archive with PDF download.
5. **Generate Chart** → standalone premium chart for any scrip.

## Tests

```bash
cd backend
# pure-logic unit tests (no DB needed; any parseable DATABASE_URL)
DATABASE_URL=postgresql+psycopg2://u:p@localhost/db pytest tests/test_pipeline_logic.py

# end-to-end happy path (needs a reachable DATABASE_URL; skips otherwise)
DATABASE_URL=postgresql+psycopg2://<user>:<pw>@localhost/ars pytest tests/test_e2e_happy_path.py
```

## Security notes

- JWT access tokens + httpOnly refresh cookie; API keys encrypted with Fernet.
- `/auth/login` and the AI/Dhan connectivity-test endpoints are rate-limited.
- PDFs and intermediate artifacts are downloadable via short-lived **signed URLs**
  (HMAC + expiry) in addition to bearer auth.
- Uploads are validated by type/size and stored outside the web root.
