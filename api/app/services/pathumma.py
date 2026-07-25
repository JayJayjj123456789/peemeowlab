"""Pathumma LLM client via AI for Thai API (/textqa/completion)."""

from __future__ import annotations

import httpx

from app.config import get_settings
from app.services.base import ServiceResult
from app.utils.logging import get_logger

logger = get_logger(__name__)

SYSTEM_PROMPT = (
    "คุณคือ JaiKrajok (ใจกระจก) เพื่อนช่วยเรียนที่เข้าใจอารมณ์ "
    "ตอบเป็นภาษาไทย ชัดเจน สุภาพ สนับสนุนผู้เรียน "
    "อย่าวินิจฉัยโรคหรือเป็นนักจิตวิทยา "
    "หากผู้ใช้มีความเสี่ยงรุนแรง ให้แนะนำติดต่อสายด่วน 1323"
)

PATHUMMA_TEXTQA_URL = "https://api.aiforthai.in.th/textqa/completion"


async def generate_reply(user_text: str, *, emotion_hint: str | None = None) -> ServiceResult:
    """Call Pathumma Text QA API (single-turn)."""
    settings = get_settings()
    if not settings.aiforthai_api_key:
        return ServiceResult(
            service="pathumma",
            ok=False,
            error="Missing AIFORTHAI_API_KEY",
        )

    prompt = user_text
    if emotion_hint:
        prompt = f"(อารมณ์โดยประมาณ: {emotion_hint})\nคำถาม/ข้อความของผู้เรียน: {user_text}"

    headers = {
        "Apikey": settings.aiforthai_api_key,
        "X-lib": "ai4thai-lib",
    }
    payload = {
        "instruction": prompt,
        "system_prompt": SYSTEM_PROMPT,
        "max_new_tokens": 512,
        "temperature": 0.4,
        "return_json": True,
    }

    url = settings.pathumma_endpoint or PATHUMMA_TEXTQA_URL
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, headers=headers, data=payload)
            try:
                raw = resp.json()
            except Exception:
                raw = {"text": resp.text}

            if resp.status_code >= 400:
                logger.warning("Pathumma HTTP %s: %s", resp.status_code, resp.text[:300])
                return ServiceResult(
                    service="pathumma",
                    ok=False,
                    error=f"HTTP {resp.status_code}",
                    raw=raw if isinstance(raw, dict) else {"body": str(raw)},
                )

            text = _extract_text(raw if isinstance(raw, dict) else {})
            return ServiceResult(
                service="pathumma",
                ok=True,
                text=text,
                raw=raw if isinstance(raw, dict) else {},
            )
    except httpx.TimeoutException:
        return ServiceResult(service="pathumma", ok=False, error="timeout")
    except Exception as exc:  # noqa: BLE001
        logger.exception("Pathumma call failed")
        return ServiceResult(service="pathumma", ok=False, error=str(exc))


def _generate_fallback_reply(user_text: str, emotion_hint: str | None) -> str:
    """Friendly fallback until Pathumma access is granted."""
    greetings = ["สวัสดี", "หวัดดี", "ดีจ้า", "hello", "hi"]
    stressed = ["เครียด", "stress", "เหนื่อย", "tired", "ท้อ"]
    homework = ["การบ้าน", "งาน", "ข้อสอบ", "สอบ", "เรียน"]

    lower_text = user_text.lower()

    if any(g in lower_text for g in greetings):
        return "สวัสดีค่ะ! ยินดีที่ได้รู้จักนะคะ 😊 มีอะไรให้ช่วยเรื่องการเรียนไหมคะ?"

    if any(s in lower_text for s in stressed):
        return "เข้าใจความรู้สึกเลยค่ะ 💙 ลองพักสักนิดแล้วค่อยกลับมาทำต่อนะคะ คุณทำได้แน่นอน!"

    if any(h in lower_text for h in homework):
        return "การบ้านเยอะใช่ไหมคะ? ลองแบ่งเป็นส่วนเล็กๆ ทำทีละอย่างน่าจะช่วยได้นะคะ ขอให้สู้ๆ! 💪"

    # Default
    return "ได้เลยค่ะ! พร้อมช่วยเรื่องการเรียนเสมอ 📚 อยากคุยเรื่องอะไรดีคะ?"


def _extract_text(raw: dict) -> str:
    if not isinstance(raw, dict):
        return str(raw)
    choices = raw.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        if isinstance(msg, dict) and msg.get("content"):
            return str(msg["content"]).strip()
        if choices[0].get("text"):
            return str(choices[0]["text"]).strip()
    for key in ("content", "response", "output", "text", "result", "generated_text"):
        if raw.get(key):
            return str(raw[key]).strip()
    return str(raw)[:2000]
