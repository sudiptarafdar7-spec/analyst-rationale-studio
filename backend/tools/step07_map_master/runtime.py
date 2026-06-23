"""Runtime for Step 7 — Map Master File.

Ported from the reference (deterministic matcher: exact → prefix → word-fuzzy,
EQUITY only, NSE preferred). Master path comes from uploaded_files via SQLAlchemy
+ resolve_uploaded_file_path (instead of the reference's raw psycopg2 / env URL).
"""
from __future__ import annotations

import os
import re

import pandas as pd
from sqlalchemy import select

from db.enums import UploadedFileType
from db.models import UploadedFile
from db.session import SessionLocal
from utils.path_utils import resolve_uploaded_file_path


def normalize_for_exact_match(s):
    if not isinstance(s, str):
        s = str(s) if s is not None else ""
    s = s.upper().strip()
    return re.sub(r"[^A-Z0-9]", "", s)


def prefix_match_score(input_norm, target_norm):
    if not input_norm or not target_norm:
        return False, 0, 0
    min_overlap = 3
    if input_norm.startswith(target_norm):
        overlap = len(target_norm)
        if overlap >= min_overlap:
            return True, overlap, (overlap / len(input_norm)) * 100
    if target_norm.startswith(input_norm):
        overlap = len(input_norm)
        if overlap >= min_overlap:
            return True, overlap, (overlap / len(target_norm)) * 100
    return False, 0, 0


def word_fuzzy_match_score(input_stock_raw, target_symbol_norm, min_chars=3):
    if not input_stock_raw or not target_symbol_norm:
        return False, 0, 0
    words = re.split(r"[\s\-_&]+", input_stock_raw.upper().strip())
    words = [w.strip() for w in words if w.strip() and len(w.strip()) >= min_chars]
    if not words:
        return False, 0, 0
    first_word = words[0]
    first_word_matched, first_match_len = False, 0
    for prefix_len in range(len(first_word), min_chars - 1, -1):
        if target_symbol_norm.startswith(first_word[:prefix_len]):
            first_word_matched, first_match_len = True, prefix_len
            break
    if not first_word_matched:
        return False, 0, 0
    matched_words, total_matched_chars = 1, first_match_len
    remaining_target = target_symbol_norm[first_match_len:]
    for word in words[1:]:
        for prefix_len in range(min(len(word), 6), min_chars - 1, -1):
            prefix = word[:prefix_len]
            if prefix in remaining_target:
                matched_words += 1
                total_matched_chars += prefix_len
                pos = remaining_target.find(prefix)
                remaining_target = remaining_target[pos + prefix_len:]
                break
    match_ratio = matched_words / len(words)
    char_coverage = total_matched_chars / len(target_symbol_norm) if target_symbol_norm else 0
    if match_ratio >= 0.5 and char_coverage >= 0.4:
        return True, (match_ratio * 50) + (char_coverage * 50), matched_words
    return False, 0, 0


def find_word_fuzzy_match(input_stock_raw, input_stock_norm, df_master, min_score=50):
    best_match, best_score, best_matched_words = None, 0, 0
    for _, row in df_master.iterrows():
        for col_norm in ["SEM_TRADING_SYMBOL_NORM", "SEM_CUSTOM_SYMBOL_NORM"]:
            target_norm = row.get(col_norm, "")
            if not target_norm or len(target_norm) < 4:
                continue
            is_match, score, matched_words = word_fuzzy_match_score(input_stock_raw, target_norm, 3)
            if is_match and score > best_score and score >= min_score:
                best_match, best_score, best_matched_words = row, score, matched_words
    return best_match, best_score, best_matched_words


def find_exact_match(input_norm, df_master, column_norm):
    return df_master[df_master[column_norm] == input_norm]


def find_prefix_match(input_norm, df_master, column_norm, min_score=70):
    best_match, best_overlap, best_score = None, 0, 0
    for _, row in df_master.iterrows():
        target_norm = row.get(column_norm, "")
        if not target_norm:
            continue
        is_match, overlap, score = prefix_match_score(input_norm, target_norm)
        if is_match and overlap > best_overlap and score >= min_score:
            best_match, best_overlap, best_score = row, overlap, score
        elif is_match and overlap == best_overlap and score > best_score:
            best_match, best_score = row, score
    return best_match, best_overlap


def _get_master_file_path() -> str:
    with SessionLocal() as db:
        row = db.scalar(
            select(UploadedFile)
            .where(UploadedFile.file_type == UploadedFileType.masterFile, UploadedFile.is_active.is_(True))
            .order_by(UploadedFile.uploaded_at.desc())
        )
    if not row:
        raise ValueError("No active master file. Upload it under Upload Required Files.")
    resolved = resolve_uploaded_file_path(row.file_path)
    print(f"📂 Master file: {row.file_path} → {resolved}")
    return resolved


def run(job_folder):
    print("\n" + "=" * 60)
    print("STEP 7: MAP MASTER FILE")
    print("=" * 60)
    try:
        analysis_folder = os.path.join(job_folder, "analysis")
        polished_csv = os.path.join(analysis_folder, "bulk-input-analysis.csv")
        original_csv = os.path.join(analysis_folder, "bulk-input.csv")
        input_csv = polished_csv if os.path.exists(polished_csv) else original_csv
        output_csv = os.path.join(analysis_folder, "mapped_master_file.csv")
        if not os.path.exists(input_csv):
            return {"success": False, "error": f"Bulk input CSV not found: {input_csv}"}

        master_file_path = _get_master_file_path()
        if not master_file_path or not os.path.exists(master_file_path):
            return {"success": False, "error": f"Master file not found at: {master_file_path}"}

        df_master = pd.read_csv(master_file_path, low_memory=False)
        df_master = df_master[df_master["SEM_INSTRUMENT_NAME"].astype(str).str.upper() == "EQUITY"].copy()
        for col in ["SEM_TRADING_SYMBOL", "SEM_CUSTOM_SYMBOL", "SM_SYMBOL_NAME", "SEM_EXM_EXCH_ID"]:
            df_master[col] = df_master[col].astype(str).str.strip().str.upper() if col in df_master.columns else ""
        df_master["SEM_TRADING_SYMBOL_NORM"] = df_master["SEM_TRADING_SYMBOL"].apply(normalize_for_exact_match)
        df_master["SEM_CUSTOM_SYMBOL_NORM"] = df_master["SEM_CUSTOM_SYMBOL"].apply(normalize_for_exact_match)
        df_master["SM_SYMBOL_NAME_NORM"] = df_master["SM_SYMBOL_NAME"].apply(normalize_for_exact_match)
        df_master["exchange_priority"] = df_master["SEM_EXM_EXCH_ID"].apply(
            lambda x: 1 if x == "NSE" else (2 if x == "BSE" else 3)
        )

        df_input = pd.read_csv(input_csv)
        df_input.columns = df_input.columns.str.strip().str.upper()
        if "INPUT STOCK" not in df_input.columns:
            if "STOCK NAME" in df_input.columns:
                df_input.rename(columns={"STOCK NAME": "INPUT STOCK"}, inplace=True)
            else:
                return {"success": False, "error": "INPUT STOCK column not found in bulk-input.csv"}
        df_input["INPUT STOCK"] = df_input["INPUT STOCK"].astype(str).str.strip().str.upper()
        df_input["INPUT_STOCK_NORM"] = df_input["INPUT STOCK"].apply(normalize_for_exact_match)

        results, matched_count = [], 0
        for _, row in df_input.iterrows():
            input_stock = row["INPUT STOCK"]
            input_stock_norm = row["INPUT_STOCK_NORM"]
            date, time = row.get("DATE", ""), row.get("TIME", "")
            analysis = row.get("ANALYSIS", row.get("RATIONALE", ""))
            chart_type = row.get("CHART TYPE", "Daily")

            candidates = find_exact_match(input_stock_norm, df_master, "SEM_TRADING_SYMBOL_NORM")
            if candidates.empty:
                candidates = find_exact_match(input_stock_norm, df_master, "SEM_CUSTOM_SYMBOL_NORM")
            if candidates.empty:
                candidates = find_exact_match(input_stock_norm, df_master, "SM_SYMBOL_NAME_NORM")
            if candidates.empty:
                pm, _ov = find_prefix_match(input_stock_norm, df_master, "SEM_TRADING_SYMBOL_NORM", 70)
                if pm is not None:
                    candidates = pd.DataFrame([pm])
            if candidates.empty:
                pm, _ov = find_prefix_match(input_stock_norm, df_master, "SEM_CUSTOM_SYMBOL_NORM", 70)
                if pm is not None:
                    candidates = pd.DataFrame([pm])
            if candidates.empty:
                fm, _sc, _mw = find_word_fuzzy_match(input_stock, input_stock_norm, df_master, 50)
                if fm is not None:
                    candidates = pd.DataFrame([fm])

            match = candidates.sort_values(by="exchange_priority").iloc[0] if not candidates.empty else None
            base = {"DATE": date, "TIME": time, "INPUT STOCK": input_stock, "ANALYSIS": analysis, "CHART TYPE": chart_type}
            if match is not None:
                base.update({
                    "STOCK SYMBOL": match.get("SEM_TRADING_SYMBOL", ""),
                    "LISTED NAME": match.get("SM_SYMBOL_NAME", ""),
                    "SHORT NAME": match.get("SEM_CUSTOM_SYMBOL", ""),
                    "SECURITY ID": match.get("SEM_SMST_SECURITY_ID", ""),
                    "EXCHANGE": match.get("SEM_EXM_EXCH_ID", ""),
                    "INSTRUMENT": match.get("SEM_INSTRUMENT_NAME", ""),
                })
                matched_count += 1
            else:
                base.update({k: "" for k in ["STOCK SYMBOL", "LISTED NAME", "SHORT NAME", "SECURITY ID", "EXCHANGE", "INSTRUMENT"]})
            results.append(base)

        os.makedirs(os.path.dirname(output_csv), exist_ok=True)
        pd.DataFrame(results).to_csv(output_csv, index=False, encoding="utf-8-sig")
        print(f"✅ Matched {matched_count}/{len(df_input)} → {output_csv}")
        return {"success": True, "output_file": output_csv, "matched_count": matched_count,
                "total_stocks": len(df_input), "error": None}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
