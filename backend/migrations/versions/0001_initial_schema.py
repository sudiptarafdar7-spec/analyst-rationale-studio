"""initial schema

Creates extensions, all enum types, every table from docs/03_DATABASE_SCHEMA.md
with FKs, indexes and constraints. Handwritten so the DDL matches the doc exactly.

Revision ID: 0001
Revises:
Create Date: 2026-06-22
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from db.enums import ENUM_LABELS
from db.types import CITEXT

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _pg_enum(name: str) -> postgresql.ENUM:
    """ENUM object for a column; the type itself is created explicitly in upgrade."""
    return postgresql.ENUM(*ENUM_LABELS[name], name=name, create_type=False)


NOW = sa.text("now()")
GEN_UUID = sa.text("gen_random_uuid()")


def upgrade() -> None:
    bind = op.get_bind()

    # --- extensions ---
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    # --- enum types ---
    for name in ENUM_LABELS:
        _pg_enum(name).create(bind, checkfirst=True)

    # --- 1. users ---
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("email", CITEXT(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("first_name", sa.Text(), nullable=False),
        sa.Column("last_name", sa.Text(), nullable=False),
        sa.Column("mobile", sa.Text()),
        sa.Column("role", _pg_enum("user_role"), nullable=False, server_default="employee"),
        sa.Column("avatar_path", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_login_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )

    # --- 2. platforms ---
    op.create_table(
        "platforms",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("platform_type", _pg_enum("platform_type"), nullable=False),
        sa.Column("channel_name", sa.Text(), nullable=False),
        sa.Column("url", sa.Text()),
        sa.Column("channel_logo_path", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )

    # --- 3. api_keys ---
    op.create_table(
        "api_keys",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("provider", _pg_enum("api_provider"), nullable=False),
        sa.Column("key_value", sa.Text(), nullable=False),
        sa.Column("label", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_tested_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("last_test_ok", sa.Boolean()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("provider", name="uq_api_keys_provider"),
    )

    # --- 4. ai_models + model_settings ---
    op.create_table(
        "ai_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("task", _pg_enum("ai_task"), nullable=False),
        sa.Column("provider", _pg_enum("api_provider"), nullable=False),
        sa.Column("model_name", sa.Text(), nullable=False),
        sa.Column("is_global_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("task", name="uq_ai_models_task"),
    )
    op.create_table(
        "model_settings",
        sa.Column("id", sa.Integer(), primary_key=True, server_default=sa.text("1")),
        sa.Column("global_model", sa.Text(), nullable=False, server_default="gpt-4o"),
        sa.Column("advanced_model", sa.Text()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.CheckConstraint("id = 1", name="model_settings_singleton"),
    )

    # --- 5. tool_configs ---
    op.create_table(
        "tool_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("tool", sa.Text(), nullable=False),
        sa.Column("config", postgresql.JSONB(), nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.UniqueConstraint("tool", name="uq_tool_configs_tool"),
    )

    # --- 6. uploaded_files ---
    op.create_table(
        "uploaded_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("file_type", _pg_enum("uploaded_file_type"), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("mime_type", sa.Text()),
        sa.Column("size_bytes", sa.BigInteger()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("uploaded_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("uploaded_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )
    op.execute(
        "CREATE INDEX ix_uploaded_files_type_active_uploaded "
        "ON uploaded_files (file_type, is_active, uploaded_at DESC)"
    )

    # --- 7. pdf_template ---
    op.create_table(
        "pdf_template",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("company_name", sa.Text(), nullable=False),
        sa.Column("registration_details", sa.Text()),
        sa.Column("disclaimer_text", sa.Text()),
        sa.Column("disclosure_text", sa.Text()),
        sa.Column("company_data", sa.Text()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )

    # --- 8. analysts ---
    op.create_table(
        "analysts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("aliases", sa.Text()),
        sa.Column("avatar_path", sa.Text()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )

    # --- 9. channels ---
    op.create_table(
        "channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("channel_name", sa.Text(), nullable=False),
        sa.Column("channel_logo_path", sa.Text()),
        sa.Column("platform", sa.Text()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )

    # --- 10. jobs ---
    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column("platform_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("platforms.id")),
        sa.Column("channel_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("channels.id")),
        sa.Column("analyst_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysts.id")),
        sa.Column("extract_all_stocks", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("youtube_url", sa.Text()),
        sa.Column("title", sa.Text()),
        sa.Column("video_date", sa.Date()),
        sa.Column("video_time", sa.Time()),
        sa.Column("audio_file_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("uploaded_files.id")),
        sa.Column("status", _pg_enum("job_status"), nullable=False, server_default="pending"),
        sa.Column("gate", _pg_enum("gate_kind"), nullable=False, server_default="none"),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error_message", sa.Text()),
        sa.Column("output_pdf_path", sa.Text()),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )
    op.execute("CREATE INDEX ix_jobs_status_created ON jobs (status, created_at DESC)")

    # --- 11. job_steps ---
    op.create_table(
        "job_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_no", sa.Integer(), nullable=False),
        sa.Column("step_key", sa.Text(), nullable=False),
        sa.Column("status", _pg_enum("step_status"), nullable=False, server_default="pending"),
        sa.Column("log_tail", sa.Text()),
        sa.Column("output_paths", postgresql.JSONB()),
        sa.Column("error", sa.Text()),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True)),
        sa.UniqueConstraint("job_id", "step_no", name="uq_job_steps_job_step"),
    )

    # --- 12. job_chart_uploads ---
    op.create_table(
        "job_chart_uploads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column(
            "job_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("input_stock", sa.Text(), nullable=False),
        sa.Column("image_path", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )

    # --- 13. refresh_tokens ---
    op.create_table(
        "refresh_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=GEN_UUID),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=NOW),
    )


def downgrade() -> None:
    for table in (
        "refresh_tokens",
        "job_chart_uploads",
        "job_steps",
        "jobs",
        "channels",
        "analysts",
        "pdf_template",
        "uploaded_files",
        "tool_configs",
        "model_settings",
        "ai_models",
        "api_keys",
        "platforms",
        "users",
    ):
        op.drop_table(table)

    bind = op.get_bind()
    for name in reversed(list(ENUM_LABELS)):
        postgresql.ENUM(name=name, create_type=False).drop(bind, checkfirst=True)
