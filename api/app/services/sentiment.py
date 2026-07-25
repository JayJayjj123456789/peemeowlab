"""AI for Thai Sentiment Analysis client."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult, SentimentResult
from app.utils.logging import get_logger

logger = get_logger(__name__)


async def analyze_sentiment(text: str) -> ServiceResult:
    """Analyze Thai text sentiment for web API."""
    result = await analyze_text(text)
    if result.ok and result.label:
        result.sentiment = SentimentResult(
            label=result.label,
            polarity=result.label,
            score=result.score or 0.5
        )
    return result


async def analyze_text(text: str) -> ServiceResult:
    """Analyze Thai text sentiment. Confirm path against AI for Thai docs."""
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(service="sentiment", ok=False, error="Missing AIFORTHAI_API_KEY")

    url = f"{settings.aiforthai_base_url.rstrip('/')}/ssense"
    headers = {
        "Apikey": settings.aiforthai_api_key,
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {"text": text}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, headers=headers, data=data)
            try:
                raw = resp.json()
            except Exception:
                raw = {"text": resp.text}

            if resp.status_code >= 400:
                logger.warning("Sentiment HTTP %s: %s", resp.status_code, resp.text[:300])
                return ServiceResult(
                    service="sentiment",
                    ok=False,
                    error=f"HTTP {resp.status_code}",
                    raw=raw if isinstance(raw, dict) else {},
                )

            label, score = _parse_sentiment(raw if isinstance(raw, dict) else {})
            return ServiceResult(
                service="sentiment",
                ok=True,
                label=label,
                score=score,
                raw=raw if isinstance(raw, dict) else {},
            )
    except httpx.TimeoutException:
        return ServiceResult(service="sentiment", ok=False, error="timeout")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Sentiment call failed")
        return ServiceResult(service="sentiment", ok=False, error=str(exc))


def _parse_sentiment(raw: dict) -> tuple[str | None, float | None]:
    sentiment = raw.get("sentiment") or raw.get("polarity") or raw.get("label")
    score = raw.get("score") or raw.get("confidence")
    if isinstance(sentiment, dict):
        label = sentiment.get("polarity") or sentiment.get("label")
        score = sentiment.get("score", score)
        return (
            str(label) if label is not None else None,
            float(score) if score is not None else None,
        )
    if sentiment is not None:
        try:
            return str(sentiment), float(score) if score is not None else None
        except (TypeError, ValueError):
            return str(sentiment), None
    return None, None
