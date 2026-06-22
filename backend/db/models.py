"""SQLAlchemy 2.x ORM models for Analyst Rationale Studio.

Mirrors docs/03_DATABASE_SCHEMA.md exactly. The handwritten initial migration
is the source of truth for DDL; these models drive the ORM and the seed script.
"""
from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base
from db.enums import (
    AiTask,
    ApiProvider,
    GateKind,
    JobStatus,
    PlatformType,
    StepStatus,
    UploadedFileType,
    UserRole,
)
from db.types import CITEXT


def _enum(py_enum: type, name: str) -> sa.Enum:
    """Native PG enum bound to a Python enum.

    create_type=False because the migration owns type creation; values_callable
    ensures DB labels are the enum *values*.
    """
    return sa.Enum(
        py_enum,
        name=name,
        native_enum=True,
        create_type=False,
        values_callable=lambda e: [m.value for m in e],
    )


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )


class TimestampMixin:
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


# --- 1. users ---------------------------------------------------------------
class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(CITEXT, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    first_name: Mapped[str] = mapped_column(Text, nullable=False)
    last_name: Mapped[str] = mapped_column(Text, nullable=False)
    mobile: Mapped[str | None] = mapped_column(Text)
    role: Mapped[UserRole] = mapped_column(
        _enum(UserRole, "user_role"), nullable=False, server_default="employee"
    )
    avatar_path: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.true()
    )
    last_login_at: Mapped[dt.datetime | None] = mapped_column(
        sa.TIMESTAMP(timezone=True)
    )


# --- 2. platforms -----------------------------------------------------------
class Platform(Base, TimestampMixin):
    __tablename__ = "platforms"

    id: Mapped[uuid.UUID] = _uuid_pk()
    platform_type: Mapped[PlatformType] = mapped_column(
        _enum(PlatformType, "platform_type"), nullable=False
    )
    channel_name: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    channel_logo_path: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.true()
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )


# --- 3. api_keys ------------------------------------------------------------
class ApiKey(Base, TimestampMixin):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = _uuid_pk()
    provider: Mapped[ApiProvider] = mapped_column(
        _enum(ApiProvider, "api_provider"), nullable=False, unique=True
    )
    key_value: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.true()
    )
    last_tested_at: Mapped[dt.datetime | None] = mapped_column(
        sa.TIMESTAMP(timezone=True)
    )
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)


# --- 4. ai_models + model_settings -----------------------------------------
class AiModel(Base, TimestampMixin):
    __tablename__ = "ai_models"

    id: Mapped[uuid.UUID] = _uuid_pk()
    task: Mapped[AiTask] = mapped_column(
        _enum(AiTask, "ai_task"), nullable=False, unique=True
    )
    provider: Mapped[ApiProvider] = mapped_column(
        _enum(ApiProvider, "api_provider"), nullable=False
    )
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    is_global_default: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.false()
    )


class ModelSettings(Base):
    __tablename__ = "model_settings"
    __table_args__ = (CheckConstraint("id = 1", name="model_settings_singleton"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, server_default=sa.text("1"))
    global_model: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="gpt-4o"
    )
    advanced_model: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


# --- 5. tool_configs --------------------------------------------------------
class ToolConfig(Base, TimestampMixin):
    __tablename__ = "tool_configs"

    id: Mapped[uuid.UUID] = _uuid_pk()
    tool: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )


# --- 6. uploaded_files ------------------------------------------------------
class UploadedFile(Base):
    __tablename__ = "uploaded_files"
    __table_args__ = (
        sa.Index(
            "ix_uploaded_files_type_active_uploaded",
            "file_type",
            "is_active",
            sa.text("uploaded_at DESC"),
        ),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    file_type: Mapped[UploadedFileType] = mapped_column(
        _enum(UploadedFileType, "uploaded_file_type"), nullable=False
    )
    file_path: Mapped[str] = mapped_column(Text, nullable=False)
    file_name: Mapped[str] = mapped_column(Text, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.true()
    )
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )
    uploaded_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


# --- 7. pdf_template --------------------------------------------------------
class PdfTemplate(Base, TimestampMixin):
    __tablename__ = "pdf_template"

    id: Mapped[uuid.UUID] = _uuid_pk()
    company_name: Mapped[str] = mapped_column(Text, nullable=False)
    registration_details: Mapped[str | None] = mapped_column(Text)
    disclaimer_text: Mapped[str | None] = mapped_column(Text)
    disclosure_text: Mapped[str | None] = mapped_column(Text)
    company_data: Mapped[str | None] = mapped_column(Text)


# --- 8. analysts ------------------------------------------------------------
class Analyst(Base, TimestampMixin):
    __tablename__ = "analysts"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    aliases: Mapped[str | None] = mapped_column(Text)
    avatar_path: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.true()
    )


# --- 9. channels ------------------------------------------------------------
class Channel(Base):
    __tablename__ = "channels"

    id: Mapped[uuid.UUID] = _uuid_pk()
    channel_name: Mapped[str] = mapped_column(Text, nullable=False)
    channel_logo_path: Mapped[str | None] = mapped_column(Text)
    platform: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


# --- 10. jobs ---------------------------------------------------------------
class Job(Base, TimestampMixin):
    __tablename__ = "jobs"
    __table_args__ = (
        sa.Index("ix_jobs_status_created", "status", sa.text("created_at DESC")),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platforms.id")
    )
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("channels.id")
    )
    analyst_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("analysts.id")
    )
    extract_all_stocks: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.false()
    )
    youtube_url: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    video_date: Mapped[dt.date | None] = mapped_column(Date)
    video_time: Mapped[dt.time | None] = mapped_column(Time)
    audio_file_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("uploaded_files.id")
    )
    status: Mapped[JobStatus] = mapped_column(
        _enum(JobStatus, "job_status"), nullable=False, server_default="pending"
    )
    gate: Mapped[GateKind] = mapped_column(
        _enum(GateKind, "gate_kind"), nullable=False, server_default="none"
    )
    current_step: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa.text("0")
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    output_pdf_path: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id")
    )


# --- 11. job_steps ----------------------------------------------------------
class JobStep(Base):
    __tablename__ = "job_steps"
    __table_args__ = (UniqueConstraint("job_id", "step_no", name="uq_job_steps_job_step"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    step_no: Mapped[int] = mapped_column(Integer, nullable=False)
    step_key: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[StepStatus] = mapped_column(
        _enum(StepStatus, "step_status"), nullable=False, server_default="pending"
    )
    log_tail: Mapped[str | None] = mapped_column(Text)
    output_paths: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[dt.datetime | None] = mapped_column(sa.TIMESTAMP(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(sa.TIMESTAMP(timezone=True))


# --- 12. job_chart_uploads --------------------------------------------------
class JobChartUpload(Base):
    __tablename__ = "job_chart_uploads"

    id: Mapped[uuid.UUID] = _uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    input_stock: Mapped[str] = mapped_column(Text, nullable=False)
    image_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )


# --- 13. refresh_tokens -----------------------------------------------------
class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False
    )
    revoked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa.false()
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.TIMESTAMP(timezone=True), nullable=False, server_default=func.now()
    )
