"""AI for Thai Text-to-Speech client."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult
from app.utils.logging import get_logger

logger = get_logger(__name__)

_MAX_TTS_CHARS = 300


async def synthesize(text: str, *, speaker: int = 0) -> ServiceResult:
    """Convert Thai text to speech using AI for Thai TTS API.

    Args:
        text: Thai text to synthesize (max 300 chars per request).
        speaker: 0 = male, 1 = female.

    Returns:
        ServiceResult with .data containing WAV audio bytes.
    """
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(service="tts", ok=False, error="Missing AIFORTHAI_API_KEY")
    if not text.strip():
        return ServiceResult(service="tts", ok=False, error="Empty text")

    url = f"{settings.aiforthai_base_url.rstrip('/')}/vaja9/synth_audiovisual"
    headers = {"Apikey": settings.aiforthai_api_key, "X-lib": "ai4thai-lib"}

    payload = {
        "input_text": text[:300],
        "speaker": speaker,
        "phrase_break": 0,
        "audiovisual": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=headers)
            try:
                raw = resp.json()
            except Exception:
                raw = {"text": resp.text}

            if resp.status_code >= 400:
                logger.warning("TTS synth HTTP %s: %s", resp.status_code, resp.text[:300])
                raw_dict = raw if isinstance(raw, dict) else {}
                api_msg = raw_dict.get("message") or raw_dict.get("error") or ""
                return ServiceResult(
                    service="tts",
                    ok=False,
                    error=f"HTTP {resp.status_code}{': ' + api_msg if api_msg else ''}",
                    raw=raw_dict,
                )

            wav_url = raw.get("wav_url") if isinstance(raw, dict) else None
            if not wav_url:
                logger.warning("TTS response missing wav_url: %s", str(raw)[:200])
                return ServiceResult(
                    service="tts",
                    ok=False,
                    error="No wav_url in response",
                    raw=raw if isinstance(raw, dict) else {},
                )

            audio_resp = await client.get(wav_url, headers=headers)
            if audio_resp.status_code >= 400:
                logger.warning("TTS download HTTP %s", audio_resp.status_code)
                return ServiceResult(
                    service="tts",
                    ok=False,
                    error=f"Audio download HTTP {audio_resp.status_code}",
                )

            return ServiceResult(
                service="tts",
                ok=True,
                data=audio_resp.content,
                raw=raw if isinstance(raw, dict) else {},
            )
    except httpx.TimeoutException:
        return ServiceResult(service="tts", ok=False, error="timeout")
    except Exception as exc:
        logger.exception("TTS call failed")
        return ServiceResult(service="tts", ok=False, error=str(exc))
