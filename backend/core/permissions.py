"""Granular permission catalog + checks.

A user has `role` (admin|employee) and a `permissions` list of keys. The wildcard
"*" grants everything (seeded admins get it). Admins see admin-area permissions
in the UI; employees see the action permissions. Backend is the source of truth:
endpoints depend on `require_perm(key)`.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from core.deps import get_current_user
from db.models import User

ALL = "*"

# key -> (label, group). group: "employee" actions or "admin" areas.
PERMISSIONS: list[dict] = [
    # employee actions
    {"key": "media:add", "label": "Add media presence", "group": "employee"},
    {"key": "media:edit", "label": "Edit media presence", "group": "employee"},
    {"key": "media:delete", "label": "Delete media presence", "group": "employee"},
    {"key": "rationale:run", "label": "Run / restart the rationale pipeline", "group": "employee"},
    {"key": "rationale:review", "label": "Review pipeline steps (gates)", "group": "employee"},
    {"key": "chart:generate", "label": "Generate charts", "group": "employee"},
    {"key": "watchlist:view", "label": "View the watchlist", "group": "employee"},
    {"key": "watchlist:refresh", "label": "Fetch CMP for watchlist", "group": "employee"},
    {"key": "watchlist:delete", "label": "Remove from watchlist", "group": "employee"},
    {"key": "jobs:view_all", "label": "See other users' jobs & entries", "group": "employee"},
    {"key": "review:sign", "label": "Sign rationales (upload signed PDF)", "group": "review"},
    # admin areas
    {"key": "admin:users", "label": "User management", "group": "admin"},
    {"key": "admin:platforms", "label": "Manage Platform", "group": "admin"},
    {"key": "admin:api_keys", "label": "Manage API Keys", "group": "admin"},
    {"key": "admin:ai_models", "label": "Manage AI Models", "group": "admin"},
    {"key": "admin:files", "label": "Upload Required Files", "group": "admin"},
    {"key": "admin:pdf_template", "label": "PDF Template", "group": "admin"},
    {"key": "admin:analysts", "label": "Analysts Profile", "group": "admin"},
]

ALL_KEYS: list[str] = [p["key"] for p in PERMISSIONS]
ADMIN_KEYS: list[str] = [p["key"] for p in PERMISSIONS if p["group"] == "admin"]
EMPLOYEE_KEYS: list[str] = [p["key"] for p in PERMISSIONS if p["group"] == "employee"]

# Sensible default grant for a brand-new employee.
REVIEWER_DEFAULT: list[str] = ["jobs:view_all", "watchlist:view", "review:sign"]

EMPLOYEE_DEFAULT: list[str] = [
    "media:add", "media:edit", "media:delete",
    "rationale:run", "rationale:review",
    "chart:generate",
    "watchlist:view", "watchlist:refresh", "watchlist:delete",
    "jobs:view_all",
]


def has_perm(user: User, key: str) -> bool:
    perms = user.permissions or []
    return ALL in perms or key in perms


def require_perm(key: str):
    """Dependency factory: 403 unless the current user holds `key` (or '*')."""

    def _dep(user: User = Depends(get_current_user)) -> User:
        if not has_perm(user, key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You don't have permission to perform this action.",
            )
        return user

    return _dep
