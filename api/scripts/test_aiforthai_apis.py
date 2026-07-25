"""Smoke tests for AI for Thai / Pathumma APIs.

Usage (from repo root, with .env filled):
    python scripts/test_aiforthai_apis.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.services import pathumma, sentiment  # noqa: E402


async def main() -> None:
    print("=== JaiKrajok API smoke tests ===")
    print(f"AIFORTHAI_API_KEY set: {bool(os.getenv('AIFORTHAI_API_KEY'))}")
    print()

    print("[1] Pathumma...")
    r = await pathumma.generate_reply("อธิบายสั้น ๆ ว่า photosynthesis คืออะไร")
    print("  ok:", r.ok)
    print("  text:", (r.text or r.error or "")[:400])
    print()

    print("[2] Sentiment...")
    r2 = await sentiment.analyze_text("วันนี้สอบตก รู้สึกท้อมาก")
    print("  ok:", r2.ok)
    print("  label:", r2.label, "score:", r2.score)
    print("  error:", r2.error)
    print()

    print("[3] Face / STT / TTS / OCR: implement after Pathumma+Sentiment pass.")
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
