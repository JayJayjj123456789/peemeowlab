"""Test the bot logic locally without LINE webhook."""
import asyncio
import sys
from pathlib import Path

# Add api to path so imports work
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.config import get_settings
from app.services import pathumma, sentiment


async def test_bot():
    """Simulate what happens when a LINE user sends a message."""
    settings = get_settings()
    
    print("=" * 60)
    print("LOCAL BOT TEST (simulates LINE message)")
    print("=" * 60)
    
    # Check config
    print("\n1. CONFIG CHECK")
    print(f"   AIFORTHAI_API_KEY: {'✓ set' if settings.aiforthai_api_key else '✗ MISSING'}")
    print(f"   LINE_CHANNEL_ACCESS_TOKEN: {'✓ set' if settings.line_channel_access_token else '✗ MISSING'}")
    print(f"   LINE_CHANNEL_SECRET: {'✓ set' if settings.line_channel_secret else '✗ MISSING'}")
    print(f"   Pathumma URL: {settings.pathumma_url}")
    
    if not settings.aiforthai_api_key:
        print("\n✗ Can't test without AIFORTHAI_API_KEY")
        return
    
    # Test message
    user_message = "สวัสดีครับ วันนี้เครียดมาก มีการบ้านเยอะ"
    print(f"\n2. USER MESSAGE")
    print(f'   "{user_message}"')
    
    # Sentiment first
    print(f"\n3. SENTIMENT ANALYSIS")
    sentiment_result = await sentiment.analyze_text(user_message)
    if sentiment_result.ok:
        print(f"   ✓ Label: {sentiment_result.label}")
        print(f"   ✓ Score: {sentiment_result.score}")
        emotion_hint = sentiment_result.label
    else:
        print(f"   ✗ Failed: {sentiment_result.error}")
        emotion_hint = None
    
    # Pathumma reply
    print(f"\n4. PATHUMMA REPLY")
    print(f"   Calling with emotion_hint={emotion_hint}...")
    reply_result = await pathumma.generate_reply(user_message, emotion_hint=emotion_hint)
    
    if reply_result.ok:
        print(f"   ✓ SUCCESS")
        print(f"\n   BOT REPLY:")
        print(f"   {'-' * 56}")
        print(f"   {reply_result.text}")
        print(f"   {'-' * 56}")
    else:
        print(f"   ✗ FAILED: {reply_result.error}")
        if reply_result.raw:
            print(f"   Raw response: {reply_result.raw}")
    
    print("\n" + "=" * 60)
    print("TEST COMPLETE")
    print("=" * 60)
    
    if reply_result.ok:
        print("\n✓ The bot logic works!")
        print("  Next: run uvicorn + ngrok + set LINE webhook")
    else:
        print("\n✗ Fix the Pathumma endpoint before proceeding")
        print("  Check docs/api_notes.md for endpoint details")


if __name__ == "__main__":
    asyncio.run(test_bot())
