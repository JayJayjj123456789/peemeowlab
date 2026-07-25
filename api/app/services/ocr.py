"""AI for Thai OCR / Handwritten Text Recognition client."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult
from app.utils.logging import get_logger

logger = get_logger(__name__)


async def extract_text(image_bytes: bytes) -> ServiceResult:
    """Extract text from an image using AI for Thai OCR API.

    Handles both handwritten and printed Thai text.
    """
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(service="ocr", ok=False, error="Missing AIFORTHAI_API_KEY")

    url = f"{settings.aiforthai_base_url.rstrip('/')}/handwritten"
    headers = {"Apikey": settings.aiforthai_api_key, "X-lib": "ai4thai-lib"}
    files = {"file": ("image.jpg", image_bytes, "image/jpeg")}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, files=files)
            try:
                raw = resp.json()
            except Exception:
                raw = {"text": resp.text}

            if resp.status_code >= 400:
                logger.warning("OCR HTTP %s: %s", resp.status_code, resp.text[:300])
                raw_dict = raw if isinstance(raw, dict) else {}
                api_msg = raw_dict.get("message") or raw_dict.get("error") or ""
                return ServiceResult(
                    service="ocr",
                    ok=False,
                    error=f"HTTP {resp.status_code}{': ' + api_msg if api_msg else ''}",
                    raw=raw_dict,
                )

            raw_dict = raw if isinstance(raw, dict) else {}
            if raw_dict.get("errmsg"):
                err = str(raw_dict["errmsg"])[:300]
                logger.warning("OCR server error: %s", err)
                return ServiceResult(
                    service="ocr",
                    ok=False,
                    error=err,
                    raw=raw_dict,
                )

            text = _extract_text(raw_dict)
            return ServiceResult(
                service="ocr",
                ok=True,
                text=text,
                raw=raw_dict,
            )
    except httpx.TimeoutException:
        return ServiceResult(service="ocr", ok=False, error="timeout")
    except Exception as exc:
        logger.exception("OCR call failed")
        return ServiceResult(service="ocr", ok=False, error=str(exc))


def _extract_text(raw: dict) -> str | None:
    for key in ("text", "content", "result", "message", "output"):
        val = raw.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
        if isinstance(val, list) and val:
            parts = [v.get("text") or v.get("content") or str(v) for v in val if isinstance(v, dict)]
            if parts:
                return " ".join(p.strip() for p in parts if p.strip())
    return None
