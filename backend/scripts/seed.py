"""Idempotent database seed.

Creates (or refreshes) the baseline rows the app needs:
  * one admin user (ADMIN_EMAIL / ADMIN_PASSWORD from env) — re-running RESETS
    the admin password to ADMIN_PASSWORD so dev login can't get stuck
  * the singleton model_settings row (global_model='gpt-4o')
  * default ai_models rows for the 4 selectable tasks -> openai / '__global__'

tool_configs are intentionally NOT seeded here — they are lazily created on
first read from each tool's DEFAULT_CONFIG (docs/03 §14).

Run from backend/:  python -m scripts.seed   (or `make seed`)
Safe to run repeatedly.
"""
from __future__ import annotations

from sqlalchemy import select

from core.config import settings
from core.security import hash_password
from db.enums import AiTask, ApiProvider, UserRole
from db.models import AiModel, ModelSettings, User
from db.session import SessionLocal

GLOBAL_MODEL_SENTINEL = "__global__"  # ai_router resolves this via model_settings
AI_TASKS = [AiTask.translate, AiTask.speaker_detect, AiTask.extract, AiTask.polish]


def seed_admin(db) -> str:
    existing = db.scalar(select(User).where(User.email == settings.ADMIN_EMAIL))
    if existing:
        # Keep the seeded account an active admin AND reset its password to the
        # configured value, so a forgotten/old password can always be recovered
        # by re-running the seed.
        existing.role = UserRole.admin
        existing.is_active = True
        existing.password_hash = hash_password(settings.ADMIN_PASSWORD)
        return f"admin reset: {existing.email} (password set from ADMIN_PASSWORD)"

    db.add(
        User(
            email=settings.ADMIN_EMAIL,
            password_hash=hash_password(settings.ADMIN_PASSWORD),
            first_name=settings.ADMIN_FIRST_NAME,
            last_name=settings.ADMIN_LAST_NAME,
            role=UserRole.admin,
            is_active=True,
        )
    )
    return f"admin created: {settings.ADMIN_EMAIL}"


def seed_model_settings(db) -> str:
    row = db.get(ModelSettings, 1)
    if row:
        return "model_settings exists"
    db.add(ModelSettings(id=1, global_model="gpt-4o"))
    return "model_settings created (global_model='gpt-4o')"


def seed_ai_models(db) -> str:
    created = []
    for task in AI_TASKS:
        if db.scalar(select(AiModel).where(AiModel.task == task)):
            continue
        db.add(
            AiModel(
                task=task,
                provider=ApiProvider.openai,
                model_name=GLOBAL_MODEL_SENTINEL,
                is_global_default=False,
            )
        )
        created.append(task.value)
    return f"ai_models created: {created or 'none (all present)'}"


def main() -> None:
    with SessionLocal() as db:
        messages = [seed_admin(db), seed_model_settings(db), seed_ai_models(db)]
        db.commit()
    for m in messages:
        print(f"  - {m}")
    print(f"seed complete. Login: {settings.ADMIN_EMAIL} / (ADMIN_PASSWORD from .env)")


if __name__ == "__main__":
    main()
