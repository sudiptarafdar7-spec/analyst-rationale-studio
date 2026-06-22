"""Custom SQLAlchemy column types."""
from __future__ import annotations

from sqlalchemy.types import UserDefinedType


class CITEXT(UserDefinedType):
    """PostgreSQL case-insensitive text (citext extension).

    SQLAlchemy core has no built-in CITEXT, so we emit the raw type. Comparison
    semantics are handled server-side by the extension.
    """

    cache_ok = True

    def get_col_spec(self, **kw) -> str:  # noqa: ANN003
        return "CITEXT"
