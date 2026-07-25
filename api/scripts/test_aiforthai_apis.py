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

from app.services import face, ocr, pathumma, sentiment, stt, tts  # noqa: E402


async def main() -> None:
    print("=== JaiKrajok API smoke tests ===")
    print(f"AIFORTHAI_API_KEY set: {bool(os.getenv('AIFORTHAI_API_KEY'))}")
    print()

    # --- Pathumma ---
    print("[1] Pathumma...")
    r = await pathumma.generate_reply("อธิบายสั้น ๆ ว่า photosynthesis คืออะไร")
    print("  ok:", r.ok)
    print("  text:", (r.text or r.error or "")[:400])
    print()

    # --- Sentiment ---
    print("[2] Sentiment...")
    r2 = await sentiment.analyze_text("วันนี้สอบตก รู้สึกท้อมาก")
    print("  ok:", r2.ok)
    print("  label:", r2.label, "score:", r2.score)
    print("  error:", r2.error)
    print()

    # --- Face ---
    print("[3] Face Detection (requires image)...")
    test_img = ROOT / "scripts" / "test_face.jpg"
    if test_img.exists():
        img_bytes = test_img.read_bytes()
        r3 = await face.analyze_image(img_bytes)
        print("  ok:", r3.ok)
        if r3.ok:
            faces = r3.raw.get("objects") or r3.raw
            print("  result:", str(faces)[:300])
        else:
            print("  error:", r3.error)
    else:
        print("  SKIP: test_face.jpg not found (place one at scripts/test_face.jpg)")
    print()

    # --- OCR ---
    print("[4] OCR (requires image with text)...")
    test_ocr = ROOT / "scripts" / "test_ocr.jpg"
    if test_ocr.exists():
        img_bytes = test_ocr.read_bytes()
        r4 = await ocr.extract_text(img_bytes)
        print("  ok:", r4.ok)
        print("  text:", (r4.text or r4.error or "")[:300])
    else:
        print("  SKIP: test_ocr.jpg not found (place one at scripts/test_ocr.jpg)")
    print()

    # --- STT ---
    print("[5] Speech-to-Text (requires wav audio)...")
    test_audio = ROOT / "scripts" / "test_speech.wav"
    if test_audio.exists():
        audio_bytes = test_audio.read_bytes()
        r5 = await stt.transcribe(audio_bytes)
        print("  ok:", r5.ok)
        print("  text:", (r5.text or r5.error or "")[:300])
    else:
        print("  SKIP: test_speech.wav not found (place one at scripts/test_speech.wav)")
    print()

    # --- TTS ---
    print("[6] Text-to-Speech...")
    r6 = await tts.synthesize("สวัสดีครับ ยินดีที่ได้รู้จัก")
    print("  ok:", r6.ok)
    if r6.ok:
        print("  audio bytes:", len(r6.data) if r6.data else 0)
    else:
        print("  error:", r6.error)
    print()

    print("=== Done ===")


if __name__ == "__main__":
    asyncio.run(main())
