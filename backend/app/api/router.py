from fastapi import APIRouter

from app.api.routes import ai, analytics, events, factory, health, production

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(factory.router)
api_router.include_router(production.router)
api_router.include_router(events.router)
api_router.include_router(analytics.router)
api_router.include_router(ai.router)
