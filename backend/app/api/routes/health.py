from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.core.database import get_supabase

router = APIRouter(prefix="/health", tags=["health"])

# Таблицы может не быть — нам важен сам факт ответа PostgREST из схемы БД.
_PROBE_TABLE = "__healthcheck_probe__"
_TABLE_NOT_FOUND_CODES = {"PGRST205", "42P01"}


@router.get("")
def health() -> dict:
    return {"status": "ok"}


@router.get("/db")
def health_db(db: Client = Depends(get_supabase)) -> dict:
    try:
        db.table(_PROBE_TABLE).select("*").limit(1).execute()
    except APIError as e:
        if e.code not in _TABLE_NOT_FOUND_CODES:
            raise HTTPException(status_code=503, detail={"database": "error", "code": e.code, "message": e.message})
    except Exception as e:
        raise HTTPException(status_code=503, detail={"database": "unreachable", "message": str(e)})
    return {"status": "ok", "database": "connected"}
