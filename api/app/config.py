"""Application settings loaded from environment / .env."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8000

    # Hackathon deploy: proxy strips /api, so root_path keeps docs working.
    root_path: str = ""
    team: str = "team07"

    aiforthai_api_key: str = ""
    aiforthai_base_url: str = "https://api.aiforthai.in.th"
    pathumma_endpoint: str = ""
    pathumma_model: str = "pathumma-llm-text-1.0.0"

    line_channel_access_token: str = ""
    line_channel_secret: str = ""

    @property
    def pathumma_url(self) -> str:
        if self.pathumma_endpoint:
            return self.pathumma_endpoint
        return f"{self.aiforthai_base_url.rstrip('/')}/pathumma-llm"


@lru_cache
def get_settings() -> Settings:
    return Settings()
