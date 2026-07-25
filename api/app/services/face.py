"""AI for Thai Face Recognition smoke client (Phase 1)."""

from __future__ import annotations

from app.services.base import ServiceResult


async def analyze_image(image_bytes: bytes) -> ServiceResult:
    _ = image_bytes
    return ServiceResult(
        service="face",
        ok=False,
        error="Not implemented yet — complete scripts/test_aiforthai_apis.py first",
    )
