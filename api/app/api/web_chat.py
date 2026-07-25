"""Web chat API endpoints for JaiKrajok frontend."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.bots.conversation import handle_text
from app.services.sentiment import analyze_sentiment

router = APIRouter(tags=["web"])


class ChatRequest(BaseModel):
    user_id: str
    message: str


class ChatResponse(BaseModel):
    reply: str
    emotion: str | None = None


class EmotionRequest(BaseModel):
    text: str


class EmotionResponse(BaseModel):
    emotion: str
    polarity: str
    confidence: float


@router.post("/api/chat/send")
async def send_message(req: ChatRequest) -> ChatResponse:
    """Handle web chat message and return AI response with emotion."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Get sentiment first
    sentiment_result = await analyze_sentiment(req.message)
    emotion = None
    if sentiment_result.ok and sentiment_result.sentiment:
        emotion = sentiment_result.sentiment.label
    
    # Generate reply using same conversation handler as LINE bot
    reply = await handle_text(req.user_id, req.message)
    
    return ChatResponse(reply=reply, emotion=emotion)


@router.post("/api/emotion/analyze")
async def analyze_emotion(req: EmotionRequest) -> EmotionResponse:
    """Analyze emotion/sentiment of text."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    result = await analyze_sentiment(req.text)
    
    if not result.ok or not result.sentiment:
        return EmotionResponse(
            emotion="neutral",
            polarity="neutral", 
            confidence=0.5
        )
    
    return EmotionResponse(
        emotion=result.sentiment.label,
        polarity=result.sentiment.polarity,
        confidence=result.sentiment.score
    )
