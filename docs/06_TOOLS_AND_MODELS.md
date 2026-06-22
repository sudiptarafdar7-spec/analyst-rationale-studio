# 06 — Tools, AI Model Management & Integrations

## 1. Tool folder convention (every pipeline tool)

```
backend/tools/<tool_name>/
├── __init__.py     # docstring = public contract; re-exports run()
├── schema.py       # DEFAULT_CONFIG, CONFIG_JSON_SCHEMA, get_effective_config(overrides)
└── runtime.py      # run(...) — pulls all options from get_effective_config()
```

### schema.py template
```python
DEFAULT_CONFIG = {
    "model": "__global__",      # '__global__' → resolve via ai_models/model_settings
    "temperature": 0.0,
    "max_output_tokens": 8192,
    "chunk_chars": 6000,
    "system_prompt": "...",
    # tool-specific keys...
}

# JSON schema describing each field for the admin UI form (type, label, help, widget).
CONFIG_JSON_SCHEMA = { ... }

def get_effective_config(overrides: dict | None = None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(load_tool_config_row(__tool_name__) or {})   # from tool_configs table
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if v is not None})
    return cfg
```

The admin **Manage AI Models** UI renders a form from each tool's `CONFIG_JSON_SCHEMA` and saves
to `tool_configs.config`. The pipeline never hardcodes any of these.

## 2. AI model resolution (`services/ai_router.py`)

Tasks with selectable engines: **translate, speaker_detect, extract, polish**. (Transcribe is
Deepgram-only.)

```python
def resolve_model(task: str, cfg_model: str | None) -> tuple[str, str]:
    # returns (provider, model_name)
    if cfg_model and cfg_model != "__global__":
        # cfg_model may already encode provider via ai_models lookup; else infer
        ...
    row = ai_models_for(task)            # provider + model_name
    if row: return row.provider, row.model_name
    return "openai", model_settings.global_model   # fallback

def get_client(provider): ...            # OpenAI() | Anthropic() | genai
def chat(provider, model, system, user, max_tokens, temperature): ...
```

Reuse `utils/openai_compat.chat_completion_kwargs(model, max_tokens, temperature)` to normalize
params (some reasoning models reject `temperature`/use `max_completion_tokens`). For Anthropic
and Gemini, implement equivalent param mapping inside `ai_router` so tool code stays
provider-agnostic: tools call `ai_router.chat(...)`, not the SDK directly.

> The reference AI tools call `openai.OpenAI(...)` directly. Refactor them to call
> `ai_router.chat(...)` so admin model selection (incl. Claude/Gemini) works. Keep prompts,
> chunking, refusal detection, and `_normalise_blocks` intact.

## 3. Provider clients

| Provider | Lib | Notes |
|---|---|---|
| OpenAI | `openai` | chat.completions; `chat_completion_kwargs` handles reasoning models |
| Anthropic | `anthropic` | `messages.create(system=..., messages=[...], max_tokens=...)` |
| Gemini | `google-generativeai` | `GenerativeModel(model).generate_content(...)`; map system as preamble |
| Deepgram | `deepgram` (SDK v7) | `listen.v1.media.transcribe_file(request=bytes, **opts)` |

All keys fetched via `utils/database.get_api_key(provider)` which **decrypts** the stored Fernet
ciphertext.

## 4. Deepgram (Step 1)
Use reference `_build_options` mapping config → `/listen` params (model, language/detect/multi,
smart_format, diarize, punctuate, paragraphs, utterances, numerals, filler_words,
profanity_filter, keyterm for nova-3). Persist `deepgram_raw.json`. Group words→utterances by
speaker. Outputs CSV/TXT/segments.json.

## 5. YouTube Data API v3 (`services/youtube.py`)
- Extract video id from URL → `videos.list(part=snippet)`.
- Return `channel` (snippet.channelTitle), `upload_date` + `upload_time` (snippet.publishedAt
  → IST split), `title`. Used by `GET /youtube/metadata`.
- Key from `api_keys` provider `youtube`.

## 6. Dhan API (`services/dhan.py`, Steps 8 & 9)
- Header: `{"Content-Type","Accept","access-token": <dhan key>}`.
- CMP: `/v2/charts/intraday` (5-min) then `/v2/charts/historical` fallback; take last close.
- Charts: `/v2/charts/historical` (daily, 8 months back) + `/v2/charts/intraday` (1-min for
  partial last candle); `_post` with retry/backoff on 429/5xx; `zip_candles` → DataFrame in IST.
- Indicators MA20/50/100/200 + Wilder RSI(14); `make_premium_chart` PNG.
- Date/time normalization helpers (Excel formats) from reference — keep them.

## 7. Scrip Master File (Step 7 input)
CSV uploaded by admin (`uploaded_files.file_type='masterFile'`). Required columns (validate on
upload):
`SEM_TRADING_SYMBOL, SEM_CUSTOM_SYMBOL, SM_SYMBOL_NAME, SEM_SMST_SECURITY_ID,
SEM_EXM_EXCH_ID, SEM_INSTRUMENT_NAME`.
Matcher filters `SEM_INSTRUMENT_NAME == 'EQUITY'`, normalizes (strip non-alnum, upper), exact →
prefix → word-fuzzy; NSE preferred over BSE via `exchange_priority`.

## 8. PDF branding sources (Step 10)
- `pdf_template`: company_name, registration_details, disclaimer, disclosure, company_data (HTML).
- `channels`: channel_name, channel_logo_path, platform (footer).
- `uploaded_files`: companyLogo, customFont (regular/bold).
- `jobs`: title, date, youtube_url.
Reuse reference `reportlab_html.extract_html_content` / `create_html_flowables` for the HTML
rich fields. Contact cards (Compliance/Principal/Grievance/General) — make these
**configurable** via `company_data` or a dedicated template field rather than hardcoded.

## 9. utils to (re)create
- `utils/database.py`: `get_db_cursor()` context manager (psycopg2) **and**/or SQLAlchemy
  session; `get_api_key(provider)` (decrypt); `resolve_uploaded_file_path`.
- `utils/openai_config.py`: `get_model()` → global model.
- `utils/openai_compat.py`: `chat_completion_kwargs(model, max_tokens, temperature)`.
- `utils/path_utils.py`: `resolve_uploaded_file_path(db_path)` (map stored path → current FS).
- `utils/reportlab_html.py`: HTML → reportlab flowables.
- `core/crypto.py`: Fernet encrypt/decrypt for API keys.

## 10. Admin "Manage AI Models" screen contract
For each task (translate, speaker_detect, extract, polish):
- Provider dropdown (OpenAI/Anthropic/Gemini) + model name field.
- Expandable advanced config rendered from the tool's `CONFIG_JSON_SCHEMA` (temperature, tokens,
  chunk size, prompt editor with a big textarea, etc.).
- "Reset to default" restores `DEFAULT_CONFIG`.
- Global/advanced fallback model setting at top.
Saving hits `PUT /admin/ai-models/{task}` and `PUT /admin/tool-configs/{tool}`.
