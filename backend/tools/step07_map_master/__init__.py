"""Step 7 — Map stocks to the Scrip Master file (deterministic).

run(job_folder) -> dict
"""
from .runtime import (  # noqa: F401
    normalize_for_exact_match,
    prefix_match_score,
    run,
    word_fuzzy_match_score,
)
