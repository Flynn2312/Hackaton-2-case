from asyncpg import Connection
from fastapi import APIRouter, Depends

from app.core.database import get_db

health_router = APIRouter(prefix="/api/health", tags=["health"])


@health_router.get("")
async def check_health():
    return {"status": "ok"}


@health_router.get("/db")
async def check_db_health(conn: Connection = Depends(get_db)):
    try:
        version = await conn.fetchval("SELECT version();")
        return {
            "db_status": "ok",
            "version": version
        }
    except Exception as e:
        return {
            "db_status": "error",
            "details": str(e)
        }
