# Reference Code

Drop your existing Python files here (the ones you already wrote). Phase 4 of
`docs/08_BUILD_ORDER.md` ports them into the tool convention. **These contain the canonical
pipeline logic — adapt, don't rewrite.**

Save your files with these names so the docs' references line up:

| Save as (here)                     | Becomes (in backend/)                          |
|------------------------------------|------------------------------------------------|
| `deepgram_runtime.py`              | `tools/deepgram_transcriber/runtime.py`        |
| `speaker_detector_runtime.py`      | `tools/speaker_detector/runtime.py`            |
| `extract_stocks_runtime.py`        | `tools/extract_stocks_analysis/runtime.py`     |
| `bulk_step2_convert_csv.py`        | `tools/bulk/convert_csv.py`                     |
| `bulk_step2b_polish.py`            | `tools/bulk/polish.py`                          |
| `bulk_step4_map_master.py`         | `tools/bulk/map_master.py`                      |
| `bulk_step4_fetch_cmp.py`          | `tools/bulk/fetch_cmp.py`                        |
| `bulk_step5_charts.py`             | `tools/bulk/charts.py`                          |
| `bulk_step6_pdf.py`                | `tools/bulk/pdf.py`                              |

## Porting notes (read before Phase 4)
- The AI tools (speaker_detector, extract_stocks, polish) currently call the OpenAI SDK
  directly. **Refactor them to call `services/ai_router.chat(...)`** so admin can pick
  OpenAI / Anthropic / Gemini per task. Keep prompts, chunking, refusal detection, and
  `_normalise_blocks` exactly as-is.
- They read API keys via `SELECT key_value FROM api_keys WHERE provider=...`. Replace with
  `utils/database.get_api_key(provider)` which **decrypts** the stored Fernet ciphertext.
- They read config via `get_effective_config(overrides)`. Implement that in each tool's
  `schema.py` (merging `DEFAULT_CONFIG` ⊕ `tool_configs` row ⊕ overrides) — see docs/06 §1.
- `deepgram_transcriber` already follows the tool convention; mirror its structure for the rest.
- The PDF/charts/CMP/master code is deterministic — port as-is, just swap DB access to the new
  `utils/database` helpers and path handling to `utils/path_utils.resolve_uploaded_file_path`.
- Hardcoded values to make configurable: contact card names/emails (Step 10), default target
  analyst name ("Pradip Halder") — these must come from `analysts` / `pdf_template` / the job.
