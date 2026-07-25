"""AI for Thai Text-to-Speech smoke client (Phase 1)."""

from __future__ import annotations

from app.services.base import ServiceResult


async def synthesize(text: str) -> ServiceResult:
    _ = text
    return ServiceResult(
        service="tts",
        ok=False,
        error="Not implemented yet",
    )
