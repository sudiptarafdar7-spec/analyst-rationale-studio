"""watchlist_calls table + call_type enum + ai_task 'watchlist' value

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-25
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # New AI task label so admins can map a model for watchlist extraction.
    op.execute("ALTER TYPE ai_task ADD VALUE IF NOT EXISTS 'watchlist'")
    # call_type enum (idempotent).
    op.execute(
        "DO $$ BEGIN "
        "IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'call_type') THEN "
        "CREATE TYPE call_type AS ENUM ('buy', 'hold', 'sell', 'no_view'); "
        "END IF; END $$;"
    )

    call_type = sa.Enum("buy", "hold", "sell", "no_view", name="call_type", create_type=False)
    op.create_table(
        "watchlist_calls",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("job_id", UUID(as_uuid=True), sa.ForeignKey("jobs.id", ondelete="SET NULL")),
        sa.Column("platform_name", sa.Text()),
        sa.Column("platform_type", sa.Text()),
        sa.Column("channel_logo_path", sa.Text()),
        sa.Column("analyst_names", sa.Text()),
        sa.Column("call_date", sa.Date()),
        sa.Column("call_time", sa.Time()),
        sa.Column("stock_symbol", sa.Text()),
        sa.Column("short_name", sa.Text()),
        sa.Column("listed_name", sa.Text()),
        sa.Column("security_id", sa.Text()),
        sa.Column("exchange", sa.Text()),
        sa.Column("instrument", sa.Text()),
        sa.Column("chart_path", sa.Text()),
        sa.Column("call_type", call_type, nullable=False, server_default="no_view"),
        sa.Column("call_cmp", sa.Float()),
        sa.Column("targets", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("stoploss", sa.Float()),
        sa.Column("downfall_target", sa.Float()),
        sa.Column("holding_period", sa.Text()),
        sa.Column("holding_period_days", sa.Integer()),
        sa.Column("analysis_text", sa.Text()),
        sa.Column("raw_extraction", JSONB()),
        sa.Column("current_cmp", sa.Float()),
        sa.Column("peak_high", sa.Float()),
        sa.Column("trough_low", sa.Float()),
        sa.Column("cmp_fetched_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_watchlist_call_date", "watchlist_calls", [sa.text("call_date DESC")])
    op.create_index("ix_watchlist_instrument", "watchlist_calls", ["instrument"])
    op.create_index("ix_watchlist_call_type", "watchlist_calls", ["call_type"])


def downgrade() -> None:
    op.drop_table("watchlist_calls")
    op.execute("DROP TYPE IF EXISTS call_type")
