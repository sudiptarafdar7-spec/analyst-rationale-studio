"""FastAPI application entrypoint for Analyst Rationale Studio."""
from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.ai_models import router as ai_models_router
from api.analysts import router as analysts_router
from api.api_keys import router as api_keys_router
from api.auth import router as auth_router
from api.files import router as files_router
from api.health import router as health_router
from api.jobs import router as jobs_router
from api.pdf_template import router as pdf_template_router
from api.platforms import router as platforms_router
from api.tools import router as tools_router
from api.users import router as users_router
from api.youtube import router as youtube_router
from core.config import settings

app = FastAPI(title="Analyst Rationale Studio API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes under /api
app.include_router(health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(api_keys_router, prefix="/api")
app.include_router(platforms_router, prefix="/api")
app.include_router(analysts_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(pdf_template_router, prefix="/api")
app.include_router(ai_models_router, prefix="/api")
app.include_router(youtube_router, prefix="/api")
app.include_router(tools_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")

# Serve uploaded files (avatars, logos, ...) from the upload dir.
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")


@app.get("/")
def root() -> dict:
    return {"name": "Analyst Rationale Studio API", "docs": "/docs"}
