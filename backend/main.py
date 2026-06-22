"""FastAPI application entrypoint for Analyst Rationale Studio.

Phase 0: app shell, CORS, and the /api/health endpoint only. Feature routers
are added in later phases.
"""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.health import router as health_router
from core.config import settings

app = FastAPI(
    title="Analyst Rationale Studio API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# All routes are mounted under /api
app.include_router(health_router, prefix="/api")


@app.get("/")
def root() -> dict:
    return {"name": "Analyst Rationale Studio API", "docs": "/docs"}
