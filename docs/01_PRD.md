# 01 — Product Requirements (PRD)

## 1. Purpose & context

SEBI-registered Research Analysts must maintain a daily, auditable record of **every stock
recommendation** they make on public media (TV, YouTube, Facebook, Instagram, Telegram,
WhatsApp, etc.). Analyst Rationale Studio automates the capture → extraction → documentation
of those calls into a branded, compliant PDF, per analyst, per appearance, per day.

## 2. Key domain rules

- A media show contains a **host** + multiple analysts (often 4–5) from different firms.
- The platform must extract **only the firm's target analyst's** calls, ignoring everyone else.
- The **stock name is frequently implicit** — spoken by the host in the question, not by the
  analyst in the answer. Extraction must bind the host's named stock to the analyst's reply.
- One analyst answer may reference **multiple stocks**; one stock may be discussed across
  **multiple turns**. Extraction and polishing must handle both.
- Numbers are spoken ("twelve fifty", "fourteen seventy five") and must become digits with ₹.
- "Extract all stocks from this video" = ignore analyst targeting, capture every call.

## 3. Personas

- **Admin** — firm owner / compliance officer. Configures platforms, API keys, AI models,
  branding, analysts. Also does everything an employee does.
- **Employee** — operations staff. Logs media appearances and runs the rationale pipeline.

## 4. User stories & acceptance criteria

### 4.1 Auth & profile (all users)
- Login with email + password; JWT session; logout.
- Profile: avatar, first name, last name, email, mobile, role (read-only), change password.
- **AC**: wrong password rejected; JWT expiry + refresh; avatar upload ≤ 5 MB image; password
  change requires current password.

### 4.2 Admin — Manage Platform
- Add/edit/delete media platforms. "Add platform" opens an **animated modal** with:
  platform type (Facebook/YouTube/Instagram/Telegram/WhatsApp, each with icon), channel
  name/username, URL, channel logo upload.
- **AC**: list shows logo + type icon + channel name + URL; delete asks confirm; a platform in
  use by jobs cannot be hard-deleted (soft delete / block with message).

### 4.3 Admin — Manage API Keys
- Store/update/remove/view keys for: OpenAI, Anthropic, Gemini, Deepgram, YouTube Data API v3,
  Dhan API.
- **AC**: keys masked by default with reveal toggle; "test connection" button per provider;
  keys stored encrypted at rest (see `docs/03`).

### 4.4 Admin — Manage AI Models
- For each AI task (transcribe is Deepgram-fixed; **translate, speaker-detect, extract,
  polish** are selectable) choose provider + model + params (temperature, max tokens, chunk size,
  system prompt). A `__global__` default model exists as fallback.
- **AC**: changing a task's model is reflected on the next pipeline run with no code change.

### 4.5 Admin — Upload Required Files
- Upload Scrip Master File (CSV from Dhan/broker), Company Logo, optional custom fonts
  (regular + bold).
- **AC**: master file is parsed/validated (required columns present, see `docs/06`); newest
  active master used by Step 7.

### 4.6 Admin — PDF Template
- Rich-HTML fields: Company Name, Registration Details, Disclaimer, Disclosure, Company Data.
- **AC**: rich text editor (bold/lists/links); fields render into the generated PDF (Step 10)
  exactly as in reference design.

### 4.7 Admin — Analysts Profile
- Add analysts to extract for: name, aliases/short names (comma-sep), profile picture.
- **AC**: aliases all map to one speaker during extraction; analyst selectable in Media Presence.

### 4.8 Media Presence (all users)
- Add entry: select platform → select channel; enter video URL; if YouTube, **auto-fetch via
  YouTube Data API**: channel, upload date, upload time, title (all editable). Upload audio file.
  Select target analyst. Toggle "extract all stocks". Add entry.
- List view rows: platform logo · channel name · date+time · **play video popup** · rationale
  status · output PDF download · actions (delete, edit, restart).
- Status lifecycle: `pending` → `running` → `paused_review` (×3 gates) → `completed` /
  `failed`. When `pending`, show **"Start making rationale"**.
- **AC**: invalid/unsupported URL handled; audio formats mp3/m4a/wav/aac; large upload progress;
  restart re-runs from step 1; edit lets user fix metadata before/after run.

### 4.9 AI Rationale pipeline (all users)
- Runs the 10 steps (`docs/05`). A **live work page** shows per-step progress, logs, and the
  current artifact preview.
- **Review gate after Step 4 (Extract)**: editable text area of extracted calls; user corrects;
  submit → continue.
- **Review gate after Step 7 (Map Master)**: editable CSV grid (stock↔symbol mapping, analysis,
  chart type); fix unmatched rows; submit → continue.
- **Chart gate in Step 9**: any stock whose chart Dhan can't produce is listed; user uploads a
  chart image per stock; submit → continue.
- On completion: **Save** (→ Saved Rationale) or **Delete** (discard job + files).
- **AC**: state survives refresh/logout; resuming hits the right step; failures show actionable
  error + retry that step.

### 4.10 Generate Chart (standalone, all users)
- Quick tool: enter stock + date/time + chart type → produce a premium chart PNG (reuses Step 9
  engine) without running the whole pipeline.

### 4.11 Saved Rationale (all users)
- Archive list of completed jobs with channel, date, analyst, PDF download, delete.

## 5. Non-functional

- **Security**: backend authz on every route; encrypted API keys; signed download URLs.
- **Resilience**: pipeline is resumable + idempotent per step; Dhan/AI retries with backoff.
- **Performance**: pipeline async in a worker; UI never blocks; chunked AI calls with TPM sleeps.
- **Auditability**: every job keeps all intermediate artifacts under `job_files/<job_id>/`.
- **Observability**: structured logs per job/step, streamed to the work page.

## 6. Out of scope (MVP)
- Billing, multi-tenant orgs, mobile native app, automated video download from URL (audio is
  uploaded manually), scheduled/automatic ingestion.
