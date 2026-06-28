"""pdf_template.design JSONB (visual builder config)

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-28
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("pdf_template", sa.Column("design", JSONB()))


def downgrade() -> None:
    op.drop_column("pdf_template", "design")
