# 07 — Frontend UI/UX (React + Vite + TS + Tailwind)

> Use the **UI/UX Pro Max skill** (install: `docs/09_SETUP.md`) for all design decisions:
> typography scale, color tokens, spacing, motion, component polish. Every screen should look
> intentional — not a default Tailwind template.

## 1. Design language

- **Brand**: professional fintech / compliance. Primary accent `#6C4CF1` (matches the PDF blue),
  neutral slate grays, success green, warning amber, danger red. Define as CSS variables + a
  Tailwind theme extension; never hardcode hex in components.
- **Type**: one humanist sans (e.g. Inter) with a clear scale (12/14/16/20/24/32). Tabular nums
  for prices/CMP.
- **Layout**: left sidebar nav + top bar (user menu, notifications). Content max-width container,
  generous whitespace, card-based surfaces with soft shadows and 12–16px radii.
- **Motion**: framer-motion for modal/popovers (the "animated popup" for Add Platform), step
  transitions on the work page, list item enter/exit. Keep it subtle and fast (150–250ms).
- **Dark mode**: optional; build with tokens so it's easy later.

## 2. App shell & navigation

Sidebar groups (order matters; admin-only items hidden for employees):

```
DASHBOARD
  • Dashboard
MEDIA PRESENCE
  • Media Presence
RATIONALE TOOLS
  • AI Rationale
OTHER TOOLS
  • Generate Chart
MANAGEMENT
  • Saved Rationale
  • Manage Profile
ADMIN            (admin only)
  • Manage Platform
  • Manage API Keys
  • Manage AI Models
  • Upload Required Files
  • PDF Template
  • Analysts Profile
```

Route guards: unauthenticated → `/login`. Admin routes wrapped in `<RequireAdmin>`.

## 3. Auth screens
- **Login**: email + password, show/hide, error toast, branded split layout (illustration/brand
  panel + form). Remember session via refresh cookie.
- **Manage Profile**: avatar uploader (crop/preview), first/last/mobile, role badge (read-only),
  change-password card (current/new/confirm with strength meter).

## 4. Dashboard
At-a-glance cards: today's media entries, jobs by status (pending/running/paused/completed),
recent rationales, quick actions ("New Media Entry", "Open AI Rationale"). Small charts
(recharts) for activity. Keep it useful, not decorative.

## 5. Media Presence
- **Add Entry** (modal or page):
  1. Platform select (cards/dropdown with type icon + logo) → Channel select (from platform).
  2. Video URL input. If YouTube detected → "Fetch details" calls `/youtube/metadata`; autofill
     channel, upload date, upload time, title (all **editable**).
  3. Audio file dropzone (mp3/m4a/wav/aac) with upload progress.
  4. Target analyst select (avatar + name) + **"Extract all stocks from this video"** toggle.
  5. "Add entry" → creates job (`pending`).
- **List**: rows show platform logo · channel name · date+time · ▶ play popup (video embed /
  audio player) · **Rationale status** chip · PDF download (if completed) · actions menu
  (delete / edit / restart). When `pending`: prominent **"Start making rationale"** button.
- Status chips: pending(slate) · running(blue, pulsing) · paused_review(amber) ·
  completed(green) · failed(red) · saved(violet).

## 6. AI Rationale — Work Page (the centerpiece)
A live, step-by-step progress view driven by the WebSocket.

- **Stepper** (vertical or horizontal) with the 10 steps; each shows icon + status (idle /
  running spinner / done check / failed / paused). Current step expanded.
- **Live log panel**: streams the emoji logs per step (monospace, auto-scroll, copyable).
- **Artifact preview**: for the active/last step, preview the output (transcript text, CSV grid,
  chart thumbnails, PDF embed).
- **Review gates** (modal or inline panel — make it prominent, can't miss it):
  - *Extract review*: large editable textarea of extracted calls + helper text ("Verify only
    {analyst}'s calls; ensure each block is STOCK then analysis"). "Save & Continue".
  - *Mapping review*: editable data grid (TanStack Table + inline edit) over the mapped CSV;
    unmatched rows highlighted red; columns: INPUT STOCK, STOCK SYMBOL, SECURITY ID, EXCHANGE,
    CHART TYPE, ANALYSIS. "Save & Continue".
  - *Chart upload*: list of failed stocks, each with an image dropzone; "Upload & Continue"
    (enabled when all provided, or allow skipping with a placeholder).
- **On completion**: success state with PDF preview + **Save** / **Delete** buttons.
- **Failure**: error banner with the failing step, message, and "Retry step" / "Restart".
- Page must **survive refresh**: on load, fetch `/jobs/{id}` + `/jobs/{id}/steps`, reconnect WS,
  and render the correct gate/step.

## 7. Generate Chart (standalone)
Form: stock (autocomplete against master if available) or security id + exchange, date, time,
chart type. Submit → render returned PNG with download. Reuses Step 9 engine server-side.

## 8. Saved Rationale
Archive table: channel, date, analyst, status, PDF download, delete. Search + filter by date /
analyst / platform.

## 9. Admin screens

### Manage Platform
- Grid/list of platforms (logo, type icon, channel name, URL, edit/delete).
- **Add Platform** = animated modal (framer-motion scale+fade). Fields: platform type
  (icon picker: Facebook/YouTube/Instagram/Telegram/WhatsApp), channel name/username, URL,
  channel logo upload (preview). Validation + optimistic update.

### Manage API Keys
- Card per provider (OpenAI, Anthropic, Gemini, Deepgram, YouTube, Dhan): masked value with
  reveal (re-auth), edit, remove, "Test connection" with status pill + last-tested time.

### Manage AI Models
- Per task (translate / speaker_detect / extract / polish): provider dropdown + model field +
  expandable advanced config form (rendered from tool `CONFIG_JSON_SCHEMA`): temperature,
  max tokens, chunk size, **system prompt editor** (large, monospace), reset-to-default.
- Top: global/advanced fallback model.

### Upload Required Files
- Scrip Master File (CSV) uploader with validation result (columns ok, row count, EQUITY count).
- Company Logo uploader (preview). Custom fonts (regular/bold) optional.
- Show currently-active file per type with replace/deactivate.

### PDF Template
- Rich-text (TipTap or similar) editors for Registration Details, Disclaimer, Disclosure,
  Company Data + Company Name field. Live "PDF preview" button (renders sample page).

### Analysts Profile
- List + Add/Edit: name, aliases (chips input), avatar. Aliases explained ("all names this
  analyst is called on air; used to group their speech").

## 10. Shared components
- `DataTable` (TanStack), `Modal`/`Dialog` (animated), `FileDropzone`, `Stepper`, `LogStream`,
  `StatusChip`, `Avatar`, `RichTextEditor`, `IconPicker`, `ConfirmDialog`, `Toast`.
- `apiClient` (fetch wrapper w/ auth + refresh), `wsClient` (reconnecting), `useJob(id)` hook
  (TanStack Query + WS merge), `useAuth` (Zustand).

## 11. Accessibility & states
Every screen handles loading / empty / error states. Forms validated with zod + react-hook-form.
Keyboard accessible modals, focus traps, ARIA labels. Toasts for all mutations.
