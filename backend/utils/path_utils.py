"""Map a stored upload path (e.g. '/uploads/master-files/x.csv') to a real
filesystem path under the configured UPLOAD_DIR."""
from __future__ import annotations

import os

from core.config import settings

_UPLOADS_PREFIX = "/uploads/"


def resolve_uploaded_file_path(db_path: str | None) -> str | None:
    """Resolve a DB-stored file path to an absolute filesystem path.

    - '/uploads/<rel>'  -> <UPLOAD_DIR>/<rel>
    - already-absolute existing path -> returned as-is
    - anything else -> treated as relative to UPLOAD_DIR
    """
    if not db_path:
        return None
    if db_path.startswith(_UPLOADS_PREFIX):
        rel = db_path[len(_UPLOADS_PREFIX):]
        return os.path.abspath(os.path.join(settings.UPLOAD_DIR, rel))
    if os.path.isabs(db_path) and os.path.exists(db_path):
        return db_path
    return os.path.abspath(os.path.join(settings.UPLOAD_DIR, db_path.lstrip("/")))
