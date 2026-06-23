"""Config schema for Step 10 — Generate PDF (reportlab; no AI options).

Branding (company name, registration, disclaimer/disclosure, logos, fonts) is
pulled live from the DB at run time (pdf_template / channels / uploaded_files).
The compliance/contact cards default here but are admin-tunable via tool_configs,
and may also be overridden by a JSON `contacts` block in pdf_template.company_data.
"""
from __future__ import annotations

from tools._schema_base import effective

TOOL_NAME = "step10_generate_pdf"

# Reference defaults (PHD Capital). Admin can override any field via tool_configs.
DEFAULT_CONFIG = {
    "theme_color": "#6C4CF1",
    "fallback_company_name": "PHD CAPITAL PVT LTD",
    "fallback_registration": (
        "SEBI Regd No - INH000016126  |  AMFI Regd No - ARN-301724  |  "
        "APMI Regd No - APRN00865\nBSE Regd No - 6152  |  "
        "CIN No.- U67190WB2020PTC237908"
    ),
    "contacts": [
        {"title": "Compliance Officer Details", "name": "Pradip Halder",
         "email": "compliance@phdcapital.in", "phone": "+91 3216 297 100"},
        {"title": "Principal Officer Details", "name": "Pritam Sardar",
         "email": "pritam@phdcapital.in", "phone": "+91 3216 297 101"},
        {"title": "Grievance Officer Details", "name": "Pradip Halder",
         "email": "compliance@phdcapital.in", "phone": "+91 3216 297 100"},
        {"title": "General Contact Details", "name": "PHD Capital",
         "email": "support@phdcapital.in", "phone": "+91 3216 297 100"},
    ],
}

CONFIG_JSON_SCHEMA: dict = {"fields": []}


def get_effective_config(overrides: dict | None = None) -> dict:
    return effective(DEFAULT_CONFIG, TOOL_NAME, overrides)
