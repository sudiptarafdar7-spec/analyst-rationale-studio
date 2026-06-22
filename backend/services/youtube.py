"""YouTube Data API v3 helpers.

Resolves a YouTube URL (channel, handle, custom/user, or a video link) to the
owning channel's title + avatar thumbnail. Uses the admin-managed `youtube`
API key (decrypted from the api_keys table).
"""
from __future__ import annotations

import re

import httpx
from fastapi import HTTPException, status

from utils.database import get_api_key

_API = "https://www.googleapis.com/youtube/v3"
_TIMEOUT = 12.0


def _key() -> str:
    key = get_api_key("youtube")
    if not key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="YouTube API key is not configured. Add it under Manage API Keys.",
        )
    return key


def _get(path: str, params: dict) -> dict:
    params = {**params, "key": _key()}
    try:
        r = httpx.get(f"{_API}/{path}", params=params, timeout=_TIMEOUT)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"YouTube request failed: {exc}") from exc
    if r.status_code == 403:
        raise HTTPException(status_code=400, detail="YouTube rejected the API key (unauthorized or quota exceeded).")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"YouTube returned HTTP {r.status_code}")
    return r.json()


def _extract(url: str) -> tuple[str, str]:
    """Return (kind, value) where kind ∈ {channel_id, handle, username, custom, video}."""
    u = url.strip()
    # Bare handle
    if u.startswith("@"):
        return "handle", u
    m = re.search(r"youtu\.be/([\w-]{11})", u)
    if m:
        return "video", m.group(1)
    m = re.search(r"[?&]v=([\w-]{11})", u)
    if m:
        return "video", m.group(1)
    m = re.search(r"youtube\.com/(?:shorts|live|embed)/([\w-]{11})", u)
    if m:
        return "video", m.group(1)
    m = re.search(r"youtube\.com/channel/(UC[\w-]+)", u)
    if m:
        return "channel_id", m.group(1)
    m = re.search(r"youtube\.com/@([\w.\-]+)", u)
    if m:
        return "handle", "@" + m.group(1)
    m = re.search(r"youtube\.com/c/([\w.\-%]+)", u)
    if m:
        return "custom", m.group(1)
    m = re.search(r"youtube\.com/user/([\w.\-]+)", u)
    if m:
        return "username", m.group(1)
    # Fallback: treat the whole thing as a search term
    return "custom", u


def _channel_id_from(kind: str, value: str) -> str:
    if kind == "channel_id":
        return value
    if kind == "video":
        data = _get("videos", {"part": "snippet", "id": value})
        items = data.get("items", [])
        if not items:
            raise HTTPException(status_code=404, detail="Video not found")
        return items[0]["snippet"]["channelId"]
    if kind == "handle":
        data = _get("channels", {"part": "id", "forHandle": value})
        items = data.get("items", [])
        if items:
            return items[0]["id"]
    if kind == "username":
        data = _get("channels", {"part": "id", "forUsername": value})
        items = data.get("items", [])
        if items:
            return items[0]["id"]
    # custom / fallback: search for a channel
    data = _get("search", {"part": "snippet", "type": "channel", "q": value, "maxResults": 1})
    items = data.get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail="Could not find a YouTube channel for that URL")
    return items[0]["snippet"]["channelId"]


def resolve_channel(url: str) -> dict:
    """Resolve a YouTube URL to {channel_id, title, thumbnail_url, channel_url}."""
    kind, value = _extract(url)
    channel_id = _channel_id_from(kind, value)
    data = _get("channels", {"part": "snippet", "id": channel_id})
    items = data.get("items", [])
    if not items:
        raise HTTPException(status_code=404, detail="YouTube channel not found")
    snip = items[0]["snippet"]
    thumbs = snip.get("thumbnails", {})
    thumb = (thumbs.get("high") or thumbs.get("medium") or thumbs.get("default") or {}).get("url")
    handle = snip.get("customUrl", "")
    channel_url = (
        f"https://www.youtube.com/{handle}" if handle.startswith("@")
        else f"https://www.youtube.com/channel/{channel_id}"
    )
    return {
        "channel_id": channel_id,
        "title": snip.get("title", ""),
        "thumbnail_url": thumb,
        "channel_url": channel_url,
    }
