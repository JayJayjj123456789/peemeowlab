"""AI for Thai Speech-to-Text smoke client (Phase 1)."""

from __future__ import annotations

from app.services.base import ServiceResult


async def transcribe(audio_bytes: bytes) -> ServiceResult:
    _ = audio_bytes
    return ServiceResult(
        service="stt",
        ok=False,
        error="Not implemented yet",
    )
