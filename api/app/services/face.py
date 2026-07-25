"""AI for Thai Face Detection client."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult
from app.utils.logging import get_logger

logger = get_logger(__name__)


async def analyze_image(image_bytes: bytes) -> ServiceResult:
    """Detect faces in an image using AI for Thai face detection API.

    Returns face count, bounding boxes, and mask status per face.
    """
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(service="face", ok=False, error="Missing AIFORTHAI_API_KEY")

    url = f"{settings.aiforthai_base_url.rstrip('/')}/facedetect-w-wo-mask"
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
                logger.warning("Face API HTTP %s: %s", resp.status_code, resp.text[:300])
                raw_dict = raw if isinstance(raw, dict) else {}
                api_msg = raw_dict.get("message") or raw_dict.get("error") or ""
                return ServiceResult(
                    service="face",
                    ok=False,
                    error=f"HTTP {resp.status_code}{': ' + api_msg if api_msg else ''}",
                    raw=raw_dict,
                )

            raw_dict = raw if isinstance(raw, dict) else {}
            if raw_dict.get("errmsg"):
                err = str(raw_dict["errmsg"])[:300]
                logger.warning("Face server error: %s", err)
                return ServiceResult(
                    service="face",
                    ok=False,
                    error=err,
                    raw=raw_dict,
                )

            objects = raw_dict.get("objects", [])
            face_count = len(objects) if isinstance(objects, list) else 0
            return ServiceResult(
                service="face",
                ok=True,
                label=str(face_count),
                score=1.0 if face_count > 0 else 0.0,
                raw=raw_dict,
            )
    except httpx.TimeoutException:
        return ServiceResult(service="face", ok=False, error="timeout")
    except Exception as exc:
        logger.exception("Face API call failed")
        return ServiceResult(service="face", ok=False, error=str(exc))
