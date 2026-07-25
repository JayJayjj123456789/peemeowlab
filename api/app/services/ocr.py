"""AI for Thai OCR smoke client (Phase 1)."""

from __future__ import annotations

from app.services.base import ServiceResult


async def extract_text(image_bytes: bytes) -> ServiceResult:
    _ = image_bytes
    return ServiceResult(
        service="ocr",
        ok=False,
        error="Not implemented yet",
    )
