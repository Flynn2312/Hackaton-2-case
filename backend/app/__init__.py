import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    analytics_router,
    assistant_router,
    decisions_router,
    digital_twin_router,
    directories_router,
    health_router,
    maintenance_router,
    production_router,
    simulator_router,
    whatif_router,
)
from app.core.config import get_settings
from app.core.database import db_manager
from app.simulator.runner import runner

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
    settings = get_settings()
    if db_manager.pool is not None:
        runner.attach(db_manager.pool)
        if settings.simulator_enabled:
            runner.start()
        else:
            logger.info("Симулятор выключен (SIMULATOR_ENABLED=false)")
    yield
    await runner.stop()
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
            analytics_router, assistant_router, decisions_router, digital_twin_router, directories_router,
            health_router, maintenance_router, production_router, simulator_router, whatif_router,
    ):
        app.include_router(r)

    # AI-движок и сценарная аналитика кейса Allur (Copilot, What-If, прогнозы, ROI)
    from app.api.routes import ai as routes_ai
    from app.api.routes import analytics as routes_analytics

    app.include_router(routes_ai.router)
    app.include_router(routes_analytics.router)

    # Дополнительные префиксы /api для совместимости
    app.include_router(routes_ai.router, prefix="/api")
    app.include_router(routes_analytics.router, prefix="/api")

    @app.get("/health", tags=["health"])
    def root_health():
        return {"status": "ok"}

    return app

