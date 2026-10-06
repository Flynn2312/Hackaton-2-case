from datetime import datetime

from asyncpg import Connection
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.repositories import analytics_repo

analytics_router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@analytics_router.get("/oee")
async def get_oee_metrics(
        factory_id: int = Query(...),
        date_from: datetime = Query(...),
        date_to: datetime = Query(...),
        conn: Connection = Depends(get_db)
):
    data = await analytics_repo.calculate_oee(conn, factory_id, date_from, date_to)
    return {"data": data}


@analytics_router.get("/production-progress")
async def get_production_progress(shift_id: int = Query(...), conn: Connection = Depends(get_db)):
    data = await analytics_repo.calculate_production_progress(conn, shift_id)
    return {"data": data}


@analytics_router.get("/quality-metrics")
async def get_quality_metrics(
        date_from: datetime = Query(...),
        date_to: datetime = Query(...),
        conn: Connection = Depends(get_db)
):
    data = await analytics_repo.calculate_quality_metrics(conn, date_from, date_to)
    return {"data": data}


@analytics_router.get("/downtime-stats")
async def get_downtime_stats(
        date_from: datetime = Query(...),
        date_to: datetime = Query(...),
        conn: Connection = Depends(get_db)
):
    data = await analytics_repo.calculate_downtime_stats(conn, date_from, date_to)
    return {"data": data}
