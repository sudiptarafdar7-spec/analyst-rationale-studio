"""job_analysts link table (many target analysts per job)

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-23
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_analysts",
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("analyst_id", UUID(as_uuid=True), sa.ForeignKey("analysts.id", ondelete="CASCADE"), primary_key=True),
    )
    # Backfill from the existing single analyst_id so old jobs keep their target.
    op.execute(
        "INSERT INTO job_analysts (job_id, analyst_id) "
        "SELECT id, analyst_id FROM jobs WHERE analyst_id IS NOT NULL "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("job_analysts")
