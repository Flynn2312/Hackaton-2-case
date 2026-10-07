from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    """Настройки приложения, загружаемые из переменных окружения и .env файла"""
    model_config = SettingsConfigDict(env_file=BASE_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Digital Twin Factory API"
    api_prefix: str = "/api"

    supabase_url: str = "https://placeholder.supabase.co"
    supabase_secret_key: str = "placeholder-key"

    database_url: str

    cors_origins: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        """Возвращает список разрешенных CORS-доменов, разобранный из строки"""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Возвращает кэшированный экземпляр настроек приложения"""
    return Settings()
