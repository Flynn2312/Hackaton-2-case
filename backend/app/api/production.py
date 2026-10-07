from datetime import datetime

from asyncpg import Connection
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.repositories import production_repo

production_router = APIRouter(prefix="/api", tags=["production"])


@production_router.get("/production-plans")
async def list_production_plans(
        factory_id: int | None = Query(None),
        shift_id: int | None = Query(None),
        car_model_id: int | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await production_repo.get_production_plans(conn, factory_id, shift_id, car_model_id, limit, offset)
    return {"data": data, "limit": limit, "offset": offset}


@production_router.get("/production-records")
async def list_production_records(
        shift_id: int | None = Query(None),
        production_area_id: int | None = Query(None),
        car_model_id: int | None = Query(None),
        date_from: datetime | None = Query(None),
        date_to: datetime | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await production_repo.get_production_records(
        conn, shift_id, production_area_id, car_model_id, date_from, date_to, limit, offset
    )
    return {"data": data, "limit": limit, "offset": offset}


@production_router.get("/quality-records")
async def list_quality_records(
        shift_id: int | None = Query(None),
        production_area_id: int | None = Query(None),
        car_model_id: int | None = Query(None),
        date_from: datetime | None = Query(None),
        date_to: datetime | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await production_repo.get_quality_records(
        conn, shift_id, production_area_id, car_model_id, date_from, date_to, limit, offset
    )
    return {"data": data, "limit": limit, "offset": offset}
