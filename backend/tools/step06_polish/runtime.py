"""Runtime for Step 6 — Polish Analysis (via ai_router).

COST OPTIMISATION vs the reference: the reference made ONE API call per stock.
Here we batch up to `batch_size` stocks into a single call and ask the model to
return a JSON object {index: polished_text}. So ≤12 stocks = 1 call instead of
12. The formatting rules (start "For {stock}", ₹, digits, ≥100 words, no first
person, never change numbers, multi-stock isolation) are unchanged.
"""
from __future__ import annotations

import json
import os
import re

import pandas as pd

from services import ai_router
from tools.step06_polish.schema import get_effective_config

TASK = "polish"

_RULES = (
    "FORMATTING RULES for each stock:\n"
    "1. Start with \"For {stock}, ...\"\n"
    "2. Include entry, target(s) and stop-loss if mentioned for THIS stock.\n"
    "3. Use ₹ for all prices; convert spoken numbers to digits (\"twelve fifty\" -> ₹1,250).\n"
    "4. At least 100 words, simple professional English, NO first person, NO speaker names.\n"
    "5. NEVER change any price/target/stop-loss/numeric value. Do not invent information.\n"
    "6. If the source mentions MULTIPLE stocks, keep ONLY this stock's levels.\n"
)


def _polish_batch(provider, model, batch, max_tokens, temperature, system) -> dict[int, str]:
    """batch: list of (index, stock_name, original). Returns {index: polished}."""
    listing = []
    for idx, name, original in batch:
        listing.append(f'--- ITEM {idx} ---\nSTOCK: {name}\nORIGINAL ANALYSIS:\n{original}')
    user = (
        _RULES
        + "\nPolish EACH item below. Return ONLY a JSON object mapping each item index "
        '(as a string) to its polished analysis, e.g. {"0": "For ...", "1": "For ..."}. '
        "No markdown, no extra keys.\n\n"
        + "\n\n".join(listing)
    )
    raw = ai_router.chat(provider, model, system, user, max_tokens, temperature)
    # Pull the JSON object out of the response (models sometimes wrap it).
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if not m:
        return {}
    try:
        data = json.loads(m.group(0))
    except Exception:
        return {}
    out: dict[int, str] = {}
    for k, v in data.items():
        try:
            out[int(k)] = str(v).strip().strip('"').strip()
        except (TypeError, ValueError):
            continue
    return out


def run(job_folder, overrides: dict | None = None) -> dict:
    print("\n" + "=" * 60)
    print("STEP 6: POLISH ANALYSIS (batched)")
    print("=" * 60)
    try:
        analysis_folder = os.path.join(job_folder, "analysis")
        input_file = os.path.join(analysis_folder, "bulk-input.csv")
        output_file = os.path.join(analysis_folder, "bulk-input-analysis.csv")
        if not os.path.exists(input_file):
            return {"success": False, "error": f"Input file not found: {input_file}"}

        cfg = get_effective_config(overrides)
        provider, model = ai_router.resolve_model(TASK, cfg.get("model"))
        max_tokens = int(cfg.get("max_output_tokens", 8192))
        temperature = float(cfg.get("temperature", 0.3))
        batch_size = max(1, int(cfg.get("batch_size", 12)))
        system = cfg.get("system_prompt") or ""

        df = pd.read_csv(input_file)
        if "ANALYSIS" not in df.columns:
            df.columns = df.columns.str.strip().str.upper()
        if "ANALYSIS" not in df.columns or "INPUT STOCK" not in df.columns:
            return {"success": False, "error": "INPUT STOCK / ANALYSIS columns missing in bulk-input.csv"}

        # Build work items (skip empty analyses).
        items = []
        for idx, row in df.iterrows():
            name = str(row["INPUT STOCK"]).strip()
            original = str(row.get("ANALYSIS", "")).strip()
            if original and original.lower() not in ("nan", "none", ""):
                items.append((idx, name, original))

        polished_count = 0
        n_calls = 0
        for start in range(0, len(items), batch_size):
            batch = items[start:start + batch_size]
            n_calls += 1
            try:
                result = _polish_batch(provider, model, batch, max_tokens, temperature, system)
            except Exception as exc:
                print(f"  ⚠️ Batch {n_calls} failed ({exc}); keeping originals for this batch.")
                result = {}
            for idx, name, original in batch:
                polished = result.get(idx, "")
                if polished and len(polished.split()) >= 50:
                    df.at[idx, "ANALYSIS"] = polished
                    polished_count += 1
                # else: keep original (already in df)

        df.to_csv(output_file, index=False, encoding="utf-8-sig")
        print(f"✅ Polished {polished_count}/{len(items)} stocks in {n_calls} API call(s) → {output_file}")
        return {"success": True, "output_file": output_file,
                "polished_count": polished_count, "total_stocks": len(df), "api_calls": n_calls}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
