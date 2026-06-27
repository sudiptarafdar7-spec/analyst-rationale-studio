"""users.permissions + user_activities table + backfill

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-27
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EMP = (
    '["media:add","media:edit","media:delete","rationale:run","rationale:review",'
    '"chart:generate","watchlist:view","watchlist:refresh","watchlist:delete","jobs:view_all"]'
)


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("permissions", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.create_table(
        "user_activities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("actor_name", sa.Text()),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("entity_type", sa.Text()),
        sa.Column("entity_id", sa.Text()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_user_activities_user_created", "user_activities", ["user_id", sa.text("created_at DESC")])
    # Backfill: admins get all, employees get the default action set.
    op.execute("UPDATE users SET permissions = '[\"*\"]'::jsonb WHERE role = 'admin'")
    op.execute(f"UPDATE users SET permissions = '{_EMP}'::jsonb WHERE role = 'employee'")


def downgrade() -> None:
    op.drop_table("user_activities")
    op.drop_column("users", "permissions")
