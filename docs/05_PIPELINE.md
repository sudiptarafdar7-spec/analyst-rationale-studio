# 05 — Rationale Pipeline (10 steps)

Orchestrator: `backend/services/pipeline.py`. Runs in the worker. Each step is a function
`run_step_N(job, cfg) -> StepResult`. The orchestrator persists `job_steps`, streams progress,
and halts at gates. **The user's reference code is the implementation basis for each step** —
wrap it, don't rewrite the logic.

## Step inputs/outputs at a glance

| # | key | input | output | engine | gate |
|---|-----|-------|--------|--------|------|
| 1 | transcribe | `audio/<file>` | transcripts/{csv,txt,segments.json,deepgram_raw.json} | Deepgram | — |
| 2 | translate | transcript.txt | translated.txt | AI (translate) | — |
| 3 | speaker_detect | translated.txt | speakers.txt | AI (speaker_detect) | — |
| 4 | extract | speakers.txt | extracted.txt | AI (extract) | **extract_review** |
| 5 | csv | analysis/bulk-input-english.txt | analysis/bulk-input.csv | parser | — |
| 6 | polish | bulk-input.csv | bulk-input-analysis.csv | AI (polish) | — |
| 7 | map_master | bulk-input-analysis.csv + master | mapped_master_file.csv | matcher | **mapping_review** |
| 8 | fetch_cmp | mapped_master_file.csv | stocks_with_cmp.csv | Dhan | — |
| 9 | charts | stocks_with_cmp.csv | charts/*.png + stocks_with_charts.csv (+ failed_charts.json) | Dhan+mpf | **chart_upload (if failures)** |
| 10| pdf | stocks_with_charts.csv + template | pdf/<channel>-<date>.pdf | reportlab | — → Save/Delete |

---

## Step 1 — Transcribe (Deepgram)
Source: reference `deepgram_transcriber/runtime.py`. Wrap into tool folder with `schema.py`
holding `DEFAULT_CONFIG` (model `nova-3`, language `hi`/`multi`/`detect`, smart_format,
diarize, punctuate, paragraphs, keyterms, request_timeout_seconds). All admin-editable.
- Produces speaker-diarized utterances → CSV/TXT/segments.json (downstream-compatible).
- `run(job_id, audio_path, api_key, overrides)`.

## Step 2 — Translate to English (AI)
New tool `translator/`. Reads `transcript.txt`, translates each chunk to English **preserving
speaker labels and timestamps line structure**. Uses `ai_router` for provider, chunking like the
other AI tools, `chat_completion_kwargs` for params. Config: model (via ai_models task
`translate`), temperature, max_tokens, chunk_chars, system_prompt (default: faithful translation,
keep `[Speaker N] [HH:MM:SS - HH:MM:SS]` prefixes, do not summarize, convert spoken numbers only
if explicitly requested — keep numbers as-is here; digit conversion happens in Polish).
Output: `translated.txt`.

## Step 3 — Detect Speakers (AI)
Source: reference `speaker_detector/runtime.py`. Re-labels utterances with role + name; injects
the **target analyst name** so the model marks `Analyst (<target>)`. Refusal detection included.
Config: model (task `speaker_detect`), temperature, max_output_tokens, chunk_chars,
target_analyst_name (filled from the job's selected analyst), system_prompt.
Output: `speakers.txt`.

## Step 4 — Extract Target Analyst Analysis (AI)  ⛔ GATE
Source: reference `extract_stocks_analysis/runtime.py`. Walks the speaker-labelled transcript
and emits **only the target analyst's** stock calls in the strict line-pair format Step 5 parses:
```
STOCK NAME
analysis text...

NEXT STOCK
analysis text...
```
- Binds host-named stocks to the analyst's reply (key requirement). The system prompt must
  instruct: when the host names a stock and the target analyst answers without naming it, attach
  that stock name. Aliases for the analyst all map to one speaker.
- If `extract_all_stocks` is true, ignore analyst targeting and extract every call.
- Config: model (task `extract`), temperature, max_output_tokens, chunk_chars, overlap_lines,
  inter_chunk_sleep_secs, target_analyst_name, aliases, system_prompt. `_normalise_blocks`
  enforces the output shape.

**GATE `extract_review`**: write output to `extracted.txt`, set `paused_review`. The review API
serves this text; user edits and submits. Orchestrator writes the edited text to
`analysis/bulk-input-english.txt`, then resumes Step 5.

> Important: the file Step 5 consumes is `analysis/bulk-input-english.txt`. Always write the
> (edited) Step-4 output there before Step 5.

## Step 5 — Convert to CSV (deterministic)
Source: reference bulk step 2. Parses `bulk-input-english.txt` into rows
`DATE,TIME,INPUT STOCK,ANALYSIS`. Splits multi-stock lines on comma/slash, cleans symbols,
deduplicates. `call_date`/`call_time` come from the job (`video_date`/`video_time`).
Output: `analysis/bulk-input.csv`. No AI.

## Step 6 — Polish Analysis (AI)
Source: reference bulk step 2b. Professionalizes each stock's ANALYSIS: starts "For {stock}, …",
₹ symbol, spoken→digit numbers, ≥100 words, no first person, no speaker names, **never changes
numeric levels**, and when the source mentions multiple stocks, keeps only the current stock's
levels. Uses task `polish` model (falls back to global). Output: `bulk-input-analysis.csv`.

## Step 7 — Map Master File (deterministic)  ⛔ GATE
Source: reference bulk step 4 (map). Matches `INPUT STOCK` → master (`SEM_TRADING_SYMBOL`,
`SEM_CUSTOM_SYMBOL`, `SM_SYMBOL_NAME`) via exact→prefix→word-fuzzy, EQUITY only, NSE preferred.
Adds STOCK SYMBOL, LISTED NAME, SHORT NAME, SECURITY ID, EXCHANGE, INSTRUMENT.
Output: `analysis/mapped_master_file.csv`.

**GATE `mapping_review`**: serve the CSV as editable rows (highlight unmatched). User fixes
symbol/security-id/analysis/chart-type, submits; orchestrator rewrites the CSV and resumes Step 8.

## Step 8 — Fetch CMP (Dhan)
Source: reference bulk step 4 (fetch_cmp). Normalizes date/time, calls Dhan intraday then
historical fallback, writes `CMP`. Output: `analysis/stocks_with_cmp.csv`. Skips rows missing
SECURITY ID (logged). Sleep between calls.

## Step 9 — Generate Charts (Dhan + mplfinance)  ⛔ CONDITIONAL GATE
Source: reference bulk step 5. Premium candlestick chart with MA20/50/100/200 + RSI(14) + CMP
line. Uses job `call_date`/`call_time` for all stocks. Writes `CHART PATH` per row, collects
failures into `failed_charts.json`. Output: `analysis/stocks_with_charts.csv` + `charts/*.png`.

**GATE `chart_upload`** (only if `failed_charts` non-empty): serve the failed list; user uploads
a chart image per failed stock (→ `job_chart_uploads`). Orchestrator copies each uploaded image
into `charts/`, sets that row's `CHART PATH`, rewrites the CSV, resumes Step 10. If no failures,
skip the gate.

## Step 10 — Generate PDF (reportlab)
Source: reference bulk step 6. Premium blue-theme report: letterhead (company name + reg details
+ logo), per-stock page (Positional chip + date, listed name (symbol), full-width chart,
Rationale "OUR GENERAL VIEW" body), Disclaimer, Disclosure, Contact Details cards, footer with
channel logo + platform + URL. Pulls branding from `pdf_template`, `channels`, `uploaded_files`,
and the job. Output: `pdf/<channel>-<date>.pdf`; set `jobs.output_pdf_path`.

On success: job → `completed`. UI offers **Save** (→ `saved`) or **Delete** (drop job + files).

---

## Orchestrator contract (pseudocode)

```python
GATES = {4: "extract_review", 7: "mapping_review"}  # 9 is conditional

def run_pipeline(job_id, start_step=1):
    job = load(job_id); set_status(job, "running")
    for n in range(start_step, 11):
        emit(job, step=n, status="running")
        try:
            result = STEPS[n](job, effective_config_for(n, job))
        except Exception as e:
            mark_step_failed(job, n, e); set_status(job, "failed"); emit_error(job, n, e); return
        mark_step_done(job, n, result)
        if n in GATES:
            pause(job, GATES[n], next_step=n+1); return
        if n == 9 and result.has_failed_charts:
            pause(job, "chart_upload", next_step=10); return
    finalize(job)  # status completed, pdf path

def resume(job_id):                 # called by /resume after a gate submit
    job = load(job_id)
    run_pipeline(job_id, start_step=job.current_step)  # current_step set to next_step at pause
```

- `effective_config_for(n, job)` merges tool defaults + `tool_configs` + ai_models mapping +
  job overrides (target analyst name, aliases, video date/time).
- Every step streams its emoji logs to both stdout and the WS channel.
- Steps are idempotent: re-running overwrites only that step's artifacts.

## Step→tool mapping

| Step | Tool folder / module |
|---|---|
| 1 | `tools/deepgram_transcriber` |
| 2 | `tools/translator` |
| 3 | `tools/speaker_detector` |
| 4 | `tools/extract_stocks_analysis` |
| 5 | `tools/bulk/convert_csv.py` |
| 6 | `tools/bulk/polish.py` |
| 7 | `tools/bulk/map_master.py` |
| 8 | `tools/bulk/fetch_cmp.py` |
| 9 | `tools/bulk/charts.py` |
| 10 | `tools/bulk/pdf.py` |
