"""JaiKrajok FastAPI entrypoint."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.webhooks.line import router as line_router
from app.api.web_chat import router as web_router
from app.config import get_settings
from app.utils.logging import setup_logging

setup_logging()
settings = get_settings()

# The hackathon reverse proxy strips the /api prefix before reaching this
# container, so routes stay unprefixed (/health) while the public URL is
# https://team07.aiforthai.in.th/api/health. root_path keeps /api/docs working.
app = FastAPI(
    title="JaiKrajok",
    description="AI Emotion-Aware Study Buddy (Phase 1)",
    version="0.1.0",
    root_path=settings.root_path,
)

# CORS for web frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(line_router)
app.include_router(web_router)

# Serve frontend
frontend_dir = Path(__file__).parent / "frontend"
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")


@app.get("/health")
async def health() -> dict:
    """Required by the deploy pipeline: must return 200 when ready."""
    return {
        "status": "ok",
        "app": "jaikrajok",
        "team": settings.team,
        "env": settings.app_env,
        "line_configured": bool(
            settings.line_channel_access_token and settings.line_channel_secret
        ),
        "aiforthai_key_set": bool(settings.aiforthai_api_key),
    }
