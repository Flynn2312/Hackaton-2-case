from fastapi import APIRouter, Depends, Query, HTTPException
from datetime import datetime
from asyncpg import Connection

from app.core.database import get_db
from app.repositories import directories_repo

directories_router = APIRouter(prefix="/api", tags=["directories"])


@directories_router.get("/factories")
async def list_factories(conn: Connection = Depends(get_db)):
    data = await directories_repo.get_factories(conn)
    return {"data": data}


@directories_router.get("/factories/{factory_id}")
async def get_factory(factory_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_factory_by_id(conn, factory_id)
    if not data:
        raise HTTPException(status_code=404, detail="Завод не найден")
    return {"data": data}


@directories_router.get("/factories/{factory_id}/hierarchy")
async def get_factory_hierarchy(factory_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_factory_hierarchy(conn, factory_id)
    if not data:
        raise HTTPException(status_code=404, detail="Иерархия не найдена (проверьте ID завода)")
    return {"data": data}


@directories_router.get("/car-models")
async def list_car_models(conn: Connection = Depends(get_db)):
    data = await directories_repo.get_car_models(conn)
    return {"data": data}


@directories_router.get("/car-models/{car_model_id}")
async def get_car_model(car_model_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_car_model_by_id(conn, car_model_id)
    if not data:
        raise HTTPException(status_code=404, detail="Модель не найдена")
    return {"data": data}


@directories_router.get("/production-areas")
async def list_production_areas(factory_id: int | None = Query(None), conn: Connection = Depends(get_db)):
    data = await directories_repo.get_production_areas(conn, factory_id)
    return {"data": data}


@directories_router.get("/production-areas/{area_id}")
async def get_production_area(area_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_production_area_by_id(conn, area_id)
    if not data:
        raise HTTPException(status_code=404, detail="Участок не найден")
    return {"data": data}


@directories_router.get("/equipment")
async def list_equipment(
        production_area_id: int | None = Query(None),
        status: str | None = Query(None),
        criticality: str | None = Query(None),
        conn: Connection = Depends(get_db)
):
    data = await directories_repo.get_equipment(conn, production_area_id, status, criticality)
    return {"data": data}


@directories_router.get("/equipment/{equipment_id}")
async def get_equipment(equipment_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_equipment_by_id(conn, equipment_id)
    if not data:
        raise HTTPException(status_code=404, detail="Оборудование не найдено")
    return {"data": data}


@directories_router.get("/shifts")
async def list_shifts(
        factory_id: int | None = Query(None),
        date_from: datetime | None = Query(None),
        date_to: datetime | None = Query(None),
        limit: int = Query(100),
        offset: int = Query(0),
        conn: Connection = Depends(get_db)
):
    data = await directories_repo.get_shifts(conn, factory_id, date_from, date_to, limit, offset)
    return {"data": data, "limit": limit, "offset": offset}


@directories_router.get("/shifts/{shift_id}")
async def get_shift(shift_id: int, conn: Connection = Depends(get_db)):
    data = await directories_repo.get_shift_by_id(conn, shift_id)
    if not data:
        raise HTTPException(status_code=404, detail="Смена не найдена")
    return {"data": data}
