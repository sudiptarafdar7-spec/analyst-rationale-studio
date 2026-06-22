"""Declarative base for all ORM models.

Models are not defined yet (Phase 1). This base + a metadata object are wired
now so Alembic autogenerate has a target to import in later phases.
"""
from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


# Phase 1 will import model modules here so that `Base.metadata` is fully
# populated for Alembic autogenerate, e.g.:
#   from db import models  # noqa: F401
