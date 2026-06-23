"""Unit tests for the pure (no DB / no network) logic of the pipeline tools.

Covers the deterministic pieces called out in CLAUDE.md §7.9:
csv parsing, symbol cleaning, master-file matching, and date/time normalization,
plus chart indicators and PDF helpers. AI steps and API calls are not tested here.
"""
from __future__ import annotations

import uuid

import pandas as pd

from tools.step05_convert_csv.runtime import (
    clean_stock_symbol,
    deduplicate_stocks,
    is_stock_line,
    parse_bulk_input,
    split_and_clean_stocks,
)
from tools.step07_map_master.runtime import (
    normalize_for_exact_match,
    prefix_match_score,
    word_fuzzy_match_score,
)
from tools.step08_fetch_cmp.runtime import normalize_date_format, normalize_time_format
from tools.step09_generate_charts.runtime import add_indicators, parse_date, parse_time, rsi
from tools.step10_generate_pdf.runtime import _as_uuid, sanitize_filename
from utils.language_detect import is_english


# --- Step 5: convert to CSV -------------------------------------------------
class TestStep05Csv:
    def test_clean_symbol_strips_parens_and_uppercases(self):
        assert clean_stock_symbol(" Hindustan Unilever (HUL) ") == "HINDUSTAN UNILEVER"
        assert clean_stock_symbol("reliance:") == "RELIANCE"
        assert clean_stock_symbol("Tata Motors -") == "TATA MOTORS"

    def test_split_multi_stock_line(self):
        out = split_and_clean_stocks("Reliance, TCS / Infosys")
        assert out == ["RELIANCE", "TCS", "INFOSYS"]

    def test_is_stock_line_distinguishes_headers_from_analysis(self):
        assert is_stock_line("Reliance -") is True
        assert is_stock_line("Hold for 2 months, target 1475 with stoploss at 1250") is False

    def test_parse_bulk_input_pairs(self):
        text = (
            "Reliance -\n"
            "Hold for two months, target 1475 plus, stoploss 1250.\n\n"
            "TCS:\n"
            "Looks strong, accumulate on dips towards 3500.\n"
        )
        entries = parse_bulk_input(text)
        assert len(entries) == 2
        assert entries[0][0] == "Reliance"
        assert "1475" in entries[0][1]
        assert entries[1][0] == "TCS"

    def test_deduplicate_keeps_first(self):
        rows = [
            {"INPUT STOCK": "RELIANCE", "ANALYSIS": "a"},
            {"INPUT STOCK": "RELIANCE", "ANALYSIS": "b"},
            {"INPUT STOCK": "TCS", "ANALYSIS": "c"},
        ]
        out = deduplicate_stocks(rows)
        assert [r["INPUT STOCK"] for r in out] == ["RELIANCE", "TCS"]


# --- Step 7: master-file matching ------------------------------------------
class TestStep07Match:
    def test_normalize_strips_non_alnum_and_uppercases(self):
        assert normalize_for_exact_match("Tata Motors") == "TATAMOTORS"
        assert normalize_for_exact_match("M&M-Fin.") == "MMFIN"

    def test_prefix_match_requires_min_overlap(self):
        ok, overlap, score = prefix_match_score("RELIANCE", "RELIANCEIND")
        assert ok and overlap >= 3 and score >= 70
        ok2, _, _ = prefix_match_score("AB", "ABCDEF")
        assert ok2 is False  # below 3-char minimum

    def test_word_fuzzy_first_word_must_lead(self):
        ok, score, _ = word_fuzzy_match_score("DEEPAK FERT", "DEEPAKFERT")
        assert ok and score > 0
        # "MEHUL" should not fuzzy-match a symbol starting with HUL
        bad, _, _ = word_fuzzy_match_score("MEHUL", "HUL")
        assert bad is False


# --- Step 8: date / time normalization -------------------------------------
class TestStep08Normalize:
    def test_date_dd_mm_yyyy(self):
        assert normalize_date_format("23/06/2026") == "2026-06-23"
        assert normalize_date_format("2026-06-23") == "2026-06-23"

    def test_date_excel_serial(self):
        # Excel serial 45000 -> 2023-03-15
        assert normalize_date_format("45000") == "2023-03-15"

    def test_time_excel_fraction_and_ampm(self):
        # 0.5 of a day = noon
        assert normalize_time_format("0.5") == "12:00:00"
        assert normalize_time_format("3:05 PM") == "15:05:00"
        assert normalize_time_format("9:15") == "09:15:00"

    def test_time_bad_input_defaults(self):
        assert normalize_time_format("garbage") == "10:00:00"


# --- Step 9: chart indicators ----------------------------------------------
class TestStep09Charts:
    def test_parse_date_formats(self):
        assert parse_date("2026-06-23").isoformat() == "2026-06-23"
        assert parse_date("23-06-2026").isoformat() == "2026-06-23"

    def test_parse_time_fallback(self):
        assert parse_time("9:15") == (9, 15, 0)
        assert parse_time("15.30.05") == (15, 30, 5)
        assert parse_time("nonsense") == (15, 30, 0)

    def test_rsi_bounded_0_100(self):
        s = pd.Series([float(x) for x in range(10, 40)])
        r = rsi(s, 14).dropna()
        assert ((r >= 0) & (r <= 100)).all()

    def test_add_indicators_adds_ma_and_rsi(self):
        df = pd.DataFrame({"close": [float(x) for x in range(1, 11)]})
        out = add_indicators(df, [20, 50, 100, 200], 14)
        for col in ["MA20", "MA50", "MA100", "MA200", "RSI14"]:
            assert col in out.columns


# --- Step 10: PDF helpers ---------------------------------------------------
class TestStep10Pdf:
    def test_sanitize_filename(self):
        assert sanitize_filename("CNBC Awaaz / Show:1") == "CNBC_Awaaz_-_Show-1"

    def test_as_uuid(self):
        u = uuid.uuid4()
        assert _as_uuid(str(u)) == u
        assert _as_uuid("not-a-uuid") is None


# --- Language detection (used by Step 2 skip-if-english) --------------------
class TestLanguageDetect:
    def test_english_text(self):
        assert is_english("Hold Reliance for two months with target 1475.") is True

    def test_hindi_text(self):
        assert is_english("रिलायंस को दो महीने के लिए होल्ड करें") is False
