"""AI for Thai Speech-to-Text client."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult
from app.utils.logging import get_logger

logger = get_logger(__name__)


async def transcribe(audio_bytes: bytes) -> ServiceResult:
    """Transcribe Thai speech audio to text using AI for Thai STT API.

    Accepts WAV audio bytes and returns the transcribed text.
    """
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(service="stt", ok=False, error="Missing AIFORTHAI_API_KEY")

    url = f"{settings.aiforthai_base_url.rstrip('/')}/partii-webapi"
    headers = {
        "Apikey": settings.aiforthai_api_key,
        "Cache-Control": "no-cache",
    }
    files = {"wavfile": ("audio.wav", audio_bytes, "audio/wav")}
    params = {"outputlevel": "--uttlevel", "outputformat": "--txt"}

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, files=files, data=params)
            try:
                raw = resp.json()
            except Exception:
                raw = {"text": resp.text}

            if resp.status_code >= 400:
                logger.warning("STT HTTP %s: %s", resp.status_code, resp.text[:300])
                raw_dict = raw if isinstance(raw, dict) else {}
                api_msg = raw_dict.get("message") or raw_dict.get("error") or ""
                return ServiceResult(
                    service="stt",
                    ok=False,
                    error=f"HTTP {resp.status_code}{': ' + api_msg if api_msg else ''}",
                    raw=raw_dict,
                )

            text = _extract_transcript(raw if isinstance(raw, dict) else {})
            return ServiceResult(
                service="stt",
                ok=True,
                text=text,
                raw=raw if isinstance(raw, dict) else {},
            )
    except httpx.TimeoutException:
        return ServiceResult(service="stt", ok=False, error="timeout")
    except Exception as exc:
        logger.exception("STT call failed")
        return ServiceResult(service="stt", ok=False, error=str(exc))


def _extract_transcript(raw: dict) -> str | None:
    text = raw.get("message") or raw.get("text") or raw.get("content") or raw.get("transcript")
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None
