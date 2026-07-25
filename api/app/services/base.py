"""Shared types for AI service responses."""

from typing import Any

from pydantic import BaseModel, Field


class SentimentResult(BaseModel):
    label: str
    polarity: str
    score: float


class ServiceResult(BaseModel):
    service: str
    ok: bool
    label: str | None = None
    score: float | None = None
    text: str | None = None
    error: str | None = None
    sentiment: SentimentResult | None = None
    raw: dict[str, Any] = Field(default_factory=dict)
