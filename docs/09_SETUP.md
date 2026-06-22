# 09 — Setup & Tooling

## 1. Prerequisites
- Python 3.11+
- Node 20+
- PostgreSQL 15+ (or Docker)
- (Optional) Redis if using Celery for the worker
- ffmpeg (audio handling, if you transcode uploads)

## 2. Install the UI/UX Pro Max skill (for Claude Code)

The skill referenced: `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill`.

Claude Code reads skills from a skills directory. Install it into the project so Claude Code uses
it for all frontend design work:

```bash
# from the repo root
mkdir -p .claude/skills
git clone https://github.com/nextlevelbuilder/ui-ux-pro-max-skill .claude/skills/ui-ux-pro-max
```

Then tell Claude Code at session start: *"Use the ui-ux-pro-max skill in
`.claude/skills/ui-ux-pro-max` for all UI work."* If the repo's README specifies a different
install path or a plugin/marketplace command, follow that instead — verify the README after
cloning.

> If the clone fails or the URL has changed, ask the user for the correct skill location before
> proceeding; do not silently skip the design system.

## 3. Environment variables (`.env`, never commit)
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ars
JWT_SECRET=<long-random>
APP_ENCRYPTION_KEY=<fernet key: python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())">
ACCESS_TOKEN_MINUTES=30
REFRESH_TOKEN_DAYS=14
# infra only — provider API keys are managed in-app (api_keys table), NOT here
REDIS_URL=redis://localhost:6379/0          # if Celery
FRONTEND_ORIGIN=http://localhost:5173
JOB_FILES_DIR=backend/job_files
```

## 4. Backend deps (requirements.txt)
```
fastapi
uvicorn[standard]
sqlalchemy>=2
alembic
psycopg2-binary
pydantic>=2
pydantic-settings
python-jose[cryptography]        # or pyjwt
passlib[bcrypt]
cryptography                     # Fernet for api key encryption
python-multipart                 # uploads
httpx
requests
pandas
numpy
pytz
python-dateutil
matplotlib
mplfinance
reportlab
Pillow
openai
anthropic
google-generativeai
deepgram-sdk>=7
google-api-python-client         # YouTube Data API v3
celery[redis]                    # if using Celery
redis                            # if using Celery
websockets
pytest
```

## 5. Frontend deps
```
react react-dom react-router-dom
@tanstack/react-query @tanstack/react-table
zustand
tailwindcss postcss autoprefixer
framer-motion
react-hook-form zod @hookform/resolvers
lucide-react                     # icons
recharts                         # dashboard charts
@tiptap/react @tiptap/starter-kit  # rich text (PDF template editors)
axios                            # or fetch wrapper
```

## 6. Run (dev)
```bash
# DB
docker compose up -d postgres redis

# backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python -m scripts.seed            # creates admin + defaults
uvicorn main:app --reload --port 8000

# frontend
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

## 7. docker-compose (dev sketch)
```yaml
services:
  postgres:
    image: postgres:15
    environment: { POSTGRES_DB: ars, POSTGRES_PASSWORD: postgres }
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  backend:
    build: ./backend
    env_file: .env
    ports: ["8000:8000"]
    volumes: ["./backend:/app", "jobfiles:/app/job_files"]
    depends_on: [postgres, redis]
  frontend:
    build: ./frontend
    ports: ["5173:5173"]
    depends_on: [backend]
volumes: { pgdata: {}, jobfiles: {} }
```

## 8. Reference code
Place the user's existing Python (the 9 documents) under `docs/reference_code/` so Claude Code
can read and port it in Phase 4. Mapping:
- `deepgram_runtime.py` → `tools/deepgram_transcriber/runtime.py`
- `speaker_detector_runtime.py` → `tools/speaker_detector/runtime.py`
- `extract_stocks_runtime.py` → `tools/extract_stocks_analysis/runtime.py`
- `bulk_step2_convert_csv.py` → `tools/bulk/convert_csv.py`
- `bulk_step2b_polish.py` → `tools/bulk/polish.py`
- `bulk_step4_map_master.py` → `tools/bulk/map_master.py`
- `bulk_step4_fetch_cmp.py` → `tools/bulk/fetch_cmp.py`
- `bulk_step5_charts.py` → `tools/bulk/charts.py`
- `bulk_step6_pdf.py` → `tools/bulk/pdf.py`

## 9. Conventions
- Black + ruff (Python), ESLint + Prettier (TS).
- Conventional Commits.
- All money/levels rendered with ₹ and tabular numerals in the UI.
- Times in IST (`Asia/Kolkata`) for market data and PDF display.
