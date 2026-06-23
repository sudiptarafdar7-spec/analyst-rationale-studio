"""Runtime for Step 5 — Convert to CSV.

Ported verbatim from the reference (deterministic parse — no AI). Parses
bulk-input-english.txt into DATE,TIME,INPUT STOCK,ANALYSIS rows, splits
multi-stock lines, cleans symbols, dedupes.
"""
from __future__ import annotations

import os
import re

import pandas as pd


def clean_stock_symbol(raw_symbol):
    if not raw_symbol:
        return ""
    symbol = raw_symbol.strip()
    symbol = re.sub(r"\s*\([^)]*\)\s*", " ", symbol)
    symbol = re.sub(r"\s*\[[^\]]*\]\s*", " ", symbol)
    symbol = re.sub(r"[\-–—:]+\s*$", "", symbol)
    symbol = re.sub(r"^[\-–—:]+\s*", "", symbol)
    symbol = re.sub(r"[^\w\s&]", " ", symbol)
    symbol = re.sub(r"\s+", " ", symbol).strip()
    return symbol.upper()


def is_stock_line(line):
    if not line or not line.strip():
        return False
    line = line.strip()
    if line.endswith("-") or line.endswith(":") or line.endswith(" -") or line.endswith(" :"):
        return True
    if len(line) > 150:
        return False
    analysis_indicators = [
        "the stock", "should", "could", "would", "might", "target", "stop loss", "stoploss",
        "support", "resistance", "breakout", "breakdown", "trading at", "currently",
        "buy above", "sell below", "hold", "accumulate", "short term", "long term",
        "medium term", "bullish", "bearish", "neutral", "positive", "negative", "maintain",
        "exit", "book profit", "stay invested", "looking good", "looking weak", "consolidating",
        "moving average", "rsi", "macd", "volume", "fundamental", "technical", "chart", "pattern",
        "i think", "we think", "my view", "our view", "price is", "cmp is", "current price",
        "recommended", "recommendation", "advised", "range of", "zone of", "levels of",
        "will reach", "can reach", "may reach", "expected", "expecting", "anticipate",
        "upside", "downside", "potential", "investment", "investor", "portfolio",
    ]
    line_lower = line.lower()
    indicator_count = sum(1 for indicator in analysis_indicators if indicator in line_lower)
    if indicator_count >= 2:
        return False
    words = line.split()
    if len(words) <= 6:
        return True
    if len(words) <= 10 and indicator_count == 0:
        return True
    return False


def parse_bulk_input(input_text):
    lines = input_text.strip().split("\n")
    entries = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if not is_stock_line(line):
            i += 1
            continue
        stock_line = line.rstrip(" -–—:").strip()
        if not stock_line:
            i += 1
            continue
        i += 1
        while i < len(lines) and not lines[i].strip():
            i += 1
        analysis_lines = []
        while i < len(lines):
            next_line = lines[i].strip()
            if not next_line:
                i += 1
                if i < len(lines) and lines[i].strip():
                    peek_line = lines[i].strip()
                    if is_stock_line(peek_line):
                        break
                    else:
                        analysis_lines.append(peek_line)
                        i += 1
                        continue
                else:
                    break
            if is_stock_line(next_line) and len(analysis_lines) > 0:
                break
            analysis_lines.append(next_line)
            i += 1
        analysis_text = " ".join(analysis_lines).strip()
        if analysis_text and len(analysis_text) >= 10:
            entries.append((stock_line, analysis_text))
        elif stock_line:
            print(f"⚠️ Skipping '{stock_line}' - no analysis found or too short")
    return entries


def split_and_clean_stocks(stock_line):
    stocks = [stock_line]
    for sep in [",", "/"]:
        new_stocks = []
        for stock in stocks:
            if sep in stock:
                for part in stock.split(sep):
                    cleaned = part.strip()
                    if cleaned:
                        new_stocks.append(cleaned)
            else:
                new_stocks.append(stock)
        stocks = new_stocks
    cleaned_stocks = []
    for stock in stocks:
        cleaned = clean_stock_symbol(stock)
        if cleaned and len(cleaned) >= 2:
            if " AND " in cleaned:
                for sub in cleaned.split(" AND "):
                    sub_cleaned = sub.strip()
                    if sub_cleaned and 2 <= len(sub_cleaned) <= 50:
                        cleaned_stocks.append(sub_cleaned)
                    elif sub_cleaned and len(sub_cleaned) > 50:
                        cleaned_stocks.append(cleaned)
                        break
            else:
                cleaned_stocks.append(cleaned)
    return cleaned_stocks


def deduplicate_stocks(rows):
    seen = set()
    unique_rows = []
    for row in rows:
        stock = row["INPUT STOCK"]
        if stock not in seen:
            seen.add(stock)
            unique_rows.append(row)
        else:
            print(f"⚠️ Removing duplicate: {stock}")
    return unique_rows


def run(job_folder, call_date, call_time):
    print("\n" + "=" * 60)
    print("STEP 5: CONVERT TO CSV")
    print("=" * 60)
    try:
        input_file = os.path.join(job_folder, "bulk-input-english.txt")
        analysis_folder = os.path.join(job_folder, "analysis")
        os.makedirs(analysis_folder, exist_ok=True)
        output_file = os.path.join(analysis_folder, "bulk-input.csv")
        if not os.path.exists(input_file):
            return {"success": False, "error": f"Translated file not found: {input_file}"}
        with open(input_file, "r", encoding="utf-8") as f:
            input_text = f.read()
        entries = parse_bulk_input(input_text)
        if not entries:
            return {"success": False, "error": "No stock entries found in input."}
        rows = []
        for stock_line, analysis in entries:
            for symbol in split_and_clean_stocks(stock_line):
                rows.append({"DATE": call_date, "TIME": call_time, "INPUT STOCK": symbol, "ANALYSIS": analysis})
        rows = deduplicate_stocks(rows)
        if not rows:
            return {"success": False, "error": "No valid stocks extracted from input text"}
        df = pd.DataFrame(rows)
        df.to_csv(output_file, index=False, encoding="utf-8-sig")
        print(f"✅ {len(df)} stock entries → {output_file}")
        return {"success": True, "output_file": output_file, "stock_count": len(df)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}
