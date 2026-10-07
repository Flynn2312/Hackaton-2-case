from datetime import datetime

from asyncpg import Connection
from fastapi import APIRouter, Query, Depends, HTTPException

from app.core.database import get_db
from app.repositories import maintenance_repo

maintenance_router = APIRouter(prefix="/api", tags=["maintenance"])


@maintenance_router.get("/downtime-events")
async def list_downtime_events(
        equipment_id: int | None = Query(None),
        shift_id: int | None = Query(None),
        type: str | None = Query(None),
        active: bool | None = Query(None, description="true — незавершенные, false — завершенные"),
        date_from: datetime | None = Query(None),
        date_to: datetime | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await maintenance_repo.get_downtime_events(
        conn, equipment_id, shift_id, type, active, date_from, date_to, limit, offset
    )
    return {"data": data, "limit": limit, "offset": offset}


@maintenance_router.get("/downtime-events/{event_id}")
async def get_downtime_event(event_id: int, conn: Connection = Depends(get_db)):
    data = await maintenance_repo.get_downtime_event_by_id(conn, event_id)
    if not data:
        raise HTTPException(status_code=404, detail="Событие простоя не найдено")
    return {"data": data}


@maintenance_router.get("/incidents")
async def list_incidents(
        production_area_id: int | None = Query(None),
        equipment_id: int | None = Query(None),
        shift_id: int | None = Query(None),
        status: str | None = Query(None),
        severity: str | None = Query(None),
        type: str | None = Query(None),
        date_from: datetime | None = Query(None),
        date_to: datetime | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await maintenance_repo.get_incidents(
        conn, production_area_id, equipment_id, shift_id, status, severity, type, date_from, date_to, limit, offset
    )
    return {"data": data, "limit": limit, "offset": offset}


@maintenance_router.get("/incidents/{incident_id}")
async def get_incident(incident_id: int, conn: Connection = Depends(get_db)):
    data = await maintenance_repo.get_incident_by_id(conn, incident_id)
    if not data:
        raise HTTPException(status_code=404, detail="Инцидент не найден")
    return {"data": data}
