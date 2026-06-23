"""In-memory progress pub/sub for pipeline jobs.

The pipeline runs in a worker thread (FastAPI BackgroundTasks). The WebSocket
handler runs on the asyncio event loop. This hub bridges the two: the worker
calls publish() (thread-safe), and subscribers receive events on asyncio Queues.

A bounded per-job history is kept so a WS client that connects mid-run (or
reconnects) can replay what it missed. job_steps in the DB remains the durable
source of truth for the polling fallback.
"""
from __future__ import annotations

import asyncio
import threading

_MAX_HISTORY = 1000


class ProgressHub:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._history: dict[str, list[dict]] = {}
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, job_id, event: dict) -> None:
        """Thread-safe: append to history and fan out to subscriber queues."""
        jid = str(job_id)
        with self._lock:
            hist = self._history.setdefault(jid, [])
            hist.append(event)
            if len(hist) > _MAX_HISTORY:
                del hist[: len(hist) - _MAX_HISTORY]
            subs = list(self._subs.get(jid, ()))
        for q in subs:
            loop = self._loop
            if loop is not None and loop.is_running():
                loop.call_soon_threadsafe(self._safe_put, q, event)
            else:
                self._safe_put(q, event)

    @staticmethod
    def _safe_put(q: asyncio.Queue, event: dict) -> None:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass

    def history(self, job_id) -> list[dict]:
        with self._lock:
            return list(self._history.get(str(job_id), ()))

    def subscribe(self, job_id) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=2000)
        with self._lock:
            self._subs.setdefault(str(job_id), set()).add(q)
        return q

    def unsubscribe(self, job_id, q: asyncio.Queue) -> None:
        with self._lock:
            subs = self._subs.get(str(job_id))
            if subs:
                subs.discard(q)
                if not subs:
                    self._subs.pop(str(job_id), None)

    def clear(self, job_id) -> None:
        with self._lock:
            self._history.pop(str(job_id), None)


hub = ProgressHub()
