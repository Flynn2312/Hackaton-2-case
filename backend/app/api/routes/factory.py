from datetime import datetime

from fastapi import APIRouter

from app.api.deps import DB, Page, found
from app.schemas.enums import Criticality, EquipmentStatus
from app.schemas.factory import CarModel, Equipment, Factory, ProductionArea, Shift
from app.services import factory as service

router = APIRouter()


@router.get("/factories", response_model=list[Factory], tags=["factories"])
def list_factories(db: DB):
    return service.list_factories(db)


@router.get("/factories/{factory_id}", response_model=Factory, tags=["factories"])
def get_factory(factory_id: int, db: DB):
    return found(service.get_factory(db, factory_id), "Factory")


@router.get("/car-models", response_model=list[CarModel], tags=["car models"])
def list_car_models(db: DB):
    return service.list_car_models(db)


@router.get("/car-models/{car_model_id}", response_model=CarModel, tags=["car models"])
def get_car_model(car_model_id: int, db: DB):
    return found(service.get_car_model(db, car_model_id), "Car model")


@router.get("/production-areas", response_model=list[ProductionArea], tags=["production areas"])
def list_production_areas(db: DB, factory_id: int | None = None):
    return service.list_production_areas(db, factory_id)


@router.get("/production-areas/{area_id}", response_model=ProductionArea, tags=["production areas"])
def get_production_area(area_id: int, db: DB):
    return found(service.get_production_area(db, area_id), "Production area")


@router.get("/equipment", response_model=list[Equipment], tags=["equipment"])
def list_equipment(
    db: DB,
    production_area_id: int | None = None,
    status: EquipmentStatus | None = None,
    criticality: Criticality | None = None,
):
    return service.list_equipment(db, production_area_id, status, criticality)


@router.get("/equipment/{equipment_id}", response_model=Equipment, tags=["equipment"])
def get_equipment(equipment_id: int, db: DB):
    return found(service.get_equipment(db, equipment_id), "Equipment")


@router.get("/shifts", response_model=list[Shift], tags=["shifts"])
def list_shifts(
    db: DB,
    page: Page,
    factory_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    return service.list_shifts(db, page.limit, page.offset, factory_id, date_from, date_to)


@router.get("/shifts/{shift_id}", response_model=Shift, tags=["shifts"])
def get_shift(shift_id: int, db: DB):
    return found(service.get_shift(db, shift_id), "Shift")
