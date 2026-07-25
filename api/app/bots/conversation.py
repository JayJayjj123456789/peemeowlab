"""Phase 1 conversation flow (in-memory)."""

from __future__ import annotations

from app.services import pathumma, sentiment
from app.utils.logging import get_logger

logger = get_logger(__name__)

_sessions: dict[str, str] = {}

WELCOME = (
    "สวัสดี เราคือ JaiKrajok (ใจกระจก) เพื่อนช่วยเรียนที่ใส่ใจอารมณ์\n\n"
    "พิมพ์เลขเมนู:\n"
    "1) คุยเรื่องเรียน\n"
    "2) เช็คอารมณ์จากข้อความ\n"
    "3) วิธีใช้ / ช่วยเหลือ\n\n"
    "หรือพิมพ์คำถามเรียนมาได้เลย"
)

HELP = (
    "วิธีใช้:\n"
    "- เมนู 1: ถามเรื่องเรียน เราจะช่วยอธิบาย\n"
    "- เมนู 2: ส่งข้อความ เราจะประมาณอารมณ์จากข้อความ\n\n"
    "หมายเหตุ: เราไม่ใช่บริการฉุกเฉินหรือแพทย์ "
    "หากทุกข์ใจมาก ติดต่อสายด่วนสุขภาพจิต 1323"
)

CRISIS_KEYWORDS = ("ฆ่าตัวตาย", "อยากตาย", "ทำร้ายตัวเอง", "ไม่มีค่า")


async def handle_text(user_id: str, text: str) -> str:
    text = (text or "").strip()
    if not text:
        return "พิมพ์ข้อความมาได้เลยนะ"

    if any(k in text for k in CRISIS_KEYWORDS):
        return (
            "เราห่วงใยคุณมาก ตอนนี้คุณไม่ได้อยู่คนเดียว "
            "โปรดติดต่อสายด่วนสุขภาพจิต 1323 "
            "หรือคนที่ไว้ใจใกล้ตัวด้วยนะ"
        )

    mode = _sessions.get(user_id, "start")

    if text in {"1", "เรียน", "study"}:
        _sessions[user_id] = "study"
        return "โหมดเรียนแล้ว ส่งคำถามมาได้เลย"
    if text in {"2", "อารมณ์", "emotion"}:
        _sessions[user_id] = "emotion"
        return "โหมดเช็คอารมณ์ ส่งข้อความที่อยากให้เราอ่านได้เลย"
    if text in {"3", "help", "ช่วยเหลือ", "เมนู", "menu"}:
        _sessions[user_id] = "start"
        return HELP + "\n\n" + WELCOME

    if mode == "emotion":
        result = await sentiment.analyze_text(text)
        _sessions[user_id] = "start"
        if not result.ok:
            return f"เช็คอารมณ์ไม่สำเร็จตอนนี้ ({result.error}). ลองใหม่หรือพิมพ์ เมนู"
        label = result.label or "unknown"
        score = f"{result.score:.2f}" if result.score is not None else "-"
        return (
            f"จากการอ่านข้อความ โดยประมาณรู้สึก: {label} (ความมั่นใจ {score})\n"
            "พักหายใจลึก ๆ สักครั้งแล้วค่อยเรียนต่อก็ได้นะ\n"
            "พิมพ์ เมนู เพื่อกลับเมนูหลัก"
        )

    result = await pathumma.generate_reply(text)
    if not result.ok:
        logger.warning("Pathumma failed for %s: %s", user_id, result.error)
        return (
            "ตอนนี้สมอง AI ตอบช้าหรือยังตั้งค่า API ไม่ครบ "
            f"({result.error}). ตรวจ .env แล้วลองใหม่ หรือพิมพ์ เมนู"
        )
    return result.text or "..."
