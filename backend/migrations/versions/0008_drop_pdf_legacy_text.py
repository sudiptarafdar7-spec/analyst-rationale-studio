"""drop pdf_template legacy text columns (disclaimer/disclosure/company_data)

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-28
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    for col in ("disclaimer_text", "disclosure_text", "company_data"):
        op.execute(f'ALTER TABLE pdf_template DROP COLUMN IF EXISTS {col}')


def downgrade() -> None:
    for col in ("disclaimer_text", "disclosure_text", "company_data"):
        op.add_column("pdf_template", sa.Column(col, sa.Text()))
