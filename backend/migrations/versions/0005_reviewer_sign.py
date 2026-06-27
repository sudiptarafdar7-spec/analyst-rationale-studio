"""reviewer role + signed status + job sign fields

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'reviewer'")
    op.execute("ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'signed'")
    op.add_column("jobs", sa.Column("signed_pdf_path", sa.Text()))
    op.add_column("jobs", sa.Column("signed_at", sa.TIMESTAMP(timezone=True)))
    op.add_column("jobs", sa.Column("signed_by", UUID(as_uuid=True), sa.ForeignKey("users.id")))
    op.add_column("jobs", sa.Column("raw_cleaned", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("jobs", "raw_cleaned")
    op.drop_column("jobs", "signed_by")
    op.drop_column("jobs", "signed_at")
    op.drop_column("jobs", "signed_pdf_path")
