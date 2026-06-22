# 03 — Database Schema (PostgreSQL)

Use SQLAlchemy 2.x models + Alembic migrations. The DDL below is the source of truth; generate
the initial migration to match it. All tables have `id` (UUID or BIGSERIAL — pick UUID for
public-facing, BIGSERIAL for internal; this doc uses UUID), `created_at`, `updated_at`.

> Convention: `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at` maintained by trigger or ORM.

## 1. users

```sql
CREATE TYPE user_role AS ENUM ('admin', 'employee');

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    mobile        TEXT,
    role          user_role NOT NULL DEFAULT 'employee',
    avatar_path   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Enable `citext` + `pgcrypto` extensions. First admin seeded via CLI/migration.

## 2. platforms (media platforms / channels)

```sql
CREATE TYPE platform_type AS ENUM
    ('youtube','facebook','instagram','telegram','whatsapp','other');

CREATE TABLE platforms (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_type  platform_type NOT NULL,
    channel_name   TEXT NOT NULL,          -- channel name / username
    url            TEXT,
    channel_logo_path TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,  -- soft delete
    created_by     UUID REFERENCES users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. api_keys

```sql
CREATE TYPE api_provider AS ENUM
    ('openai','anthropic','gemini','deepgram','youtube','dhan');

CREATE TABLE api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider     api_provider UNIQUE NOT NULL,   -- one active key per provider
    key_value    TEXT NOT NULL,                  -- Fernet-encrypted ciphertext
    label        TEXT,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    last_tested_at TIMESTAMPTZ,
    last_test_ok BOOLEAN,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
> Reference code reads `SELECT key_value FROM api_keys WHERE provider = 'openai'`. Keep that
> read path but **decrypt** in the accessor (`utils/database.get_api_key(provider)`).

## 4. ai_tasks & ai_models (model management)

```sql
-- The tasks whose engine is admin-selectable.
CREATE TYPE ai_task AS ENUM ('translate','speaker_detect','extract','polish');

CREATE TABLE ai_models (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task         ai_task UNIQUE NOT NULL,
    provider     api_provider NOT NULL,       -- openai | anthropic | gemini
    model_name   TEXT NOT NULL,               -- e.g. 'gpt-4o', 'claude-...', 'gemini-...'
    is_global_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A single row for the global advanced/default model fallback.
CREATE TABLE model_settings (
    id            INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    global_model  TEXT NOT NULL DEFAULT 'gpt-4o',
    advanced_model TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 5. tool_configs (per-tool admin-editable options)

```sql
CREATE TABLE tool_configs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool       TEXT UNIQUE NOT NULL,   -- 'deepgram_transcriber','translator','speaker_detector','extract_stocks_analysis','polish','map_master', ...
    config     JSONB NOT NULL,         -- merged over the tool's DEFAULT_CONFIG
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
`get_effective_config(overrides)` = tool `DEFAULT_CONFIG` ⊕ this `config` ⊕ `overrides`.

## 6. uploaded_files (master file, logos, fonts)

```sql
CREATE TYPE uploaded_file_type AS ENUM
    ('masterFile','companyLogo','customFont','channelLogo','chartImage','avatar','audio');

CREATE TABLE uploaded_files (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_type   uploaded_file_type NOT NULL,
    file_path   TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    mime_type   TEXT,
    size_bytes  BIGINT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON uploaded_files (file_type, is_active, uploaded_at DESC);
```
> Reference code: `WHERE file_type = 'masterFile' ORDER BY uploaded_at DESC LIMIT 1`. Keep it.

## 7. pdf_template

```sql
CREATE TABLE pdf_template (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name         TEXT NOT NULL,
    registration_details TEXT,        -- HTML rich text
    disclaimer_text      TEXT,        -- HTML
    disclosure_text      TEXT,        -- HTML
    company_data         TEXT,        -- HTML
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Step 10 reads the latest row (`ORDER BY id DESC LIMIT 1`).

## 8. analysts

```sql
CREATE TABLE analysts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,            -- primary/canonical name (target)
    aliases       TEXT,                     -- comma-separated short names
    avatar_path   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 9. channels (firm's own channels, for PDF footer/branding)

The reference PDF code joins `jobs → channels`. Model the firm's branded channel info:

```sql
CREATE TABLE channels (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_name      TEXT NOT NULL,
    channel_logo_path TEXT,
    platform          TEXT,                 -- display label e.g. 'Youtube'
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
> In MVP, `platforms` (media sources) and `channels` (firm branding) are separate concerns.
> A media-presence entry references a `platforms` row; the PDF footer uses a `channels` row
> (or reuse the selected platform — decide and document; keep the reference join working).

## 10. jobs (media presence entry == one rationale job)

```sql
CREATE TYPE job_status AS ENUM
    ('pending','running','paused_review','completed','failed','saved');
CREATE TYPE gate_kind AS ENUM
    ('none','extract_review','mapping_review','chart_upload');

CREATE TABLE jobs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id        UUID REFERENCES platforms(id),
    channel_id         UUID REFERENCES channels(id),
    analyst_id         UUID REFERENCES analysts(id),
    extract_all_stocks BOOLEAN NOT NULL DEFAULT FALSE,
    youtube_url        TEXT,
    title              TEXT,
    video_date         DATE,            -- 'date' in reference PDF query
    video_time         TIME,
    audio_file_id      UUID REFERENCES uploaded_files(id),
    status             job_status NOT NULL DEFAULT 'pending',
    gate               gate_kind NOT NULL DEFAULT 'none',
    current_step       INT NOT NULL DEFAULT 0,   -- 0..10
    error_message      TEXT,
    output_pdf_path    TEXT,
    created_by         UUID REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON jobs (status, created_at DESC);
```
> Reference PDF query: `SELECT c.channel_name, c.channel_logo_path, j.title, j.date,
> j.youtube_url, c.platform FROM jobs j LEFT JOIN channels c ...`. Keep column names
> compatible (alias `video_date` → `date` in the query or rename to `date`; document choice).

## 11. job_steps (pipeline progress + artifacts)

```sql
CREATE TYPE step_status AS ENUM ('pending','running','done','failed','skipped');

CREATE TABLE job_steps (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    step_no     INT NOT NULL,         -- 1..10
    step_key    TEXT NOT NULL,        -- 'transcribe','translate',...
    status      step_status NOT NULL DEFAULT 'pending',
    log_tail    TEXT,                 -- last N log lines
    output_paths JSONB,               -- {"csv": "...", ...}
    error       TEXT,
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    UNIQUE (job_id, step_no)
);
```

## 12. job_chart_uploads (Step 9 fallback images)

```sql
CREATE TABLE job_chart_uploads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    input_stock TEXT NOT NULL,
    image_path  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 13. refresh_tokens (optional, if not stateless)

```sql
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 14. Seed data (initial migration)

- One admin user (from env or CLI prompt).
- `model_settings` single row (`global_model='gpt-4o'`).
- `ai_models` rows for the 4 tasks (defaults to OpenAI/global).
- `tool_configs` rows seeded from each tool's `DEFAULT_CONFIG` (or lazy-created on first read).

## 15. Extensions

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive email
```
