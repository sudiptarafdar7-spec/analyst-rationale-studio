"""PostgreSQL enum types, mirrored as Python enums.

The enum *labels* equal the enum *values* (name == value) so ORM persistence
and raw SQL agree. The handwritten initial migration creates the matching
Postgres ENUM types with these exact labels.
"""
from __future__ import annotations

import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    employee = "employee"


class PlatformType(str, enum.Enum):
    youtube = "youtube"
    facebook = "facebook"
    instagram = "instagram"
    telegram = "telegram"
    whatsapp = "whatsapp"
    other = "other"


class ApiProvider(str, enum.Enum):
    openai = "openai"
    anthropic = "anthropic"
    gemini = "gemini"
    deepgram = "deepgram"
    youtube = "youtube"
    dhan = "dhan"


class AiTask(str, enum.Enum):
    translate = "translate"
    speaker_detect = "speaker_detect"
    extract = "extract"
    polish = "polish"
    watchlist = "watchlist"


class CallType(str, enum.Enum):
    """Standardised recommendation extracted from an analyst's rationale."""

    buy = "buy"
    hold = "hold"
    sell = "sell"
    no_view = "no_view"


class UploadedFileType(str, enum.Enum):
    masterFile = "masterFile"
    companyLogo = "companyLogo"
    customFont = "customFont"
    channelLogo = "channelLogo"
    chartImage = "chartImage"
    avatar = "avatar"
    audio = "audio"


class JobStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    paused_review = "paused_review"
    completed = "completed"
    failed = "failed"
    saved = "saved"


class GateKind(str, enum.Enum):
    none = "none"
    extract_review = "extract_review"
    mapping_review = "mapping_review"
    chart_upload = "chart_upload"


class StepStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"
    skipped = "skipped"


# Enum name -> ordered list of labels. Single source of truth shared by the
# migration so the PG types and ORM stay in lockstep.
ENUM_LABELS: dict[str, list[str]] = {
    "user_role": [e.value for e in UserRole],
    "platform_type": [e.value for e in PlatformType],
    "api_provider": [e.value for e in ApiProvider],
    "ai_task": [e.value for e in AiTask],
    "call_type": [e.value for e in CallType],
    "uploaded_file_type": [e.value for e in UploadedFileType],
    "job_status": [e.value for e in JobStatus],
    "gate_kind": [e.value for e in GateKind],
    "step_status": [e.value for e in StepStatus],
}
