import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    ai_router,
    analytics_router,
    digital_twin_router,
    directories_router,
    health_router,
    maintenance_router,
    production_router
)
from app.core.config import get_settings
from app.core.database import db_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [%(module)s] %(message)s",
    datefmt="%H:%M:%S"
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Инициализация пула соединений с БД...")
    await db_manager.connect()
    yield
    logger.info("Закрытие соединений с БД...")
    await db_manager.disconnect()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)

    # Настройка CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    for r in (
            ai_router, analytics_router, digital_twin_router, directories_router,
            health_router, maintenance_router, production_router
    ):
        app.include_router(r)

    # Маршруты цифрового двойника и AI-движка для кейса Allur
    from app.api.routes import ai as routes_ai
    from app.api.routes import analytics as routes_analytics
    from app.api.routes import factory as routes_factory
    from app.api.routes import production as routes_production
    from app.api.routes import events as routes_events

    app.include_router(routes_ai.router)
    app.include_router(routes_analytics.router)
    app.include_router(routes_factory.router)
    app.include_router(routes_production.router)
    app.include_router(routes_events.router)

    # Дополнительные префиксы /api для совместимости
    app.include_router(routes_ai.router, prefix="/api")
    app.include_router(routes_analytics.router, prefix="/api")

    @app.get("/health", tags=["health"])
    def root_health():
        return {"status": "ok"}

    return app

