"""Tiny in-memory sliding-window rate limiter.

Sufficient for a single-instance MVP (docs/04 asks to rate-limit /auth/login and
the AI-test endpoints). Swap for Redis if the API is scaled horizontally.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status


class SlidingWindowLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self._hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.max_requests:
            retry = int(self.window - (now - q[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many attempts. Please try again later.",
                headers={"Retry-After": str(retry)},
            )
        q.append(now)


# 10 login attempts per minute per client IP.
login_limiter = SlidingWindowLimiter(max_requests=10, window_seconds=60)


def rate_limit_login(request: Request) -> None:
    client = request.client.host if request.client else "unknown"
    login_limiter.check(f"login:{client}")
