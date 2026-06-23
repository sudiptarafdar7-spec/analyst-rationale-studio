"""YouTube metadata endpoint — autofill for Media Presence entries."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from core.deps import get_current_user
from db.models import User
from schemas.integrations import YoutubeMetadataOut
from services.youtube import video_metadata

router = APIRouter(prefix="/youtube", tags=["youtube"])


@router.get("/metadata", response_model=YoutubeMetadataOut)
def youtube_metadata(
    url: str = Query(..., min_length=3, description="A YouTube video URL or 11-char id"),
    _user: User = Depends(get_current_user),
) -> YoutubeMetadataOut:
    """Resolve a video URL to {channel, upload_date, upload_time (IST), title}."""
    return YoutubeMetadataOut(**video_metadata(url))
