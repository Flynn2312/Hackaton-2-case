from datetime import datetime

from supabase import Client

from app.schemas.enums import Criticality, EquipmentStatus
from app.schemas.factory import CarModel, Equipment, Factory, ProductionArea, Shift
from app.services.base import apply_filters, apply_period, get_by_id, paginate


def list_factories(db: Client) -> list[Factory]:
    rows = db.table("factories").select("*").order("id").execute().data
    return [Factory(**r) for r in rows]


def get_factory(db: Client, factory_id: int) -> Factory | None:
    row = get_by_id(db, "factories", factory_id)
    return Factory(**row) if row else None


def list_car_models(db: Client) -> list[CarModel]:
    rows = db.table("car_models").select("*").order("id").execute().data
    return [CarModel(**r) for r in rows]


def get_car_model(db: Client, car_model_id: int) -> CarModel | None:
    row = get_by_id(db, "car_models", car_model_id)
    return CarModel(**row) if row else None


def list_production_areas(db: Client, factory_id: int | None = None) -> list[ProductionArea]:
    query = apply_filters(db.table("production_areas").select("*"), factory_id=factory_id)
    rows = query.order("sequence").execute().data
    return [ProductionArea(**r) for r in rows]


def get_production_area(db: Client, area_id: int) -> ProductionArea | None:
    row = get_by_id(db, "production_areas", area_id)
    return ProductionArea(**row) if row else None


def list_equipment(
    db: Client,
    production_area_id: int | None = None,
    status: EquipmentStatus | None = None,
    criticality: Criticality | None = None,
) -> list[Equipment]:
    query = apply_filters(
        db.table("equipment").select("*"),
        production_area_id=production_area_id, status=status, criticality=criticality,
    )
    rows = query.order("id").execute().data
    return [Equipment(**r) for r in rows]


def get_equipment(db: Client, equipment_id: int) -> Equipment | None:
    row = get_by_id(db, "equipment", equipment_id)
    return Equipment(**row) if row else None


def list_shifts(
    db: Client,
    limit: int,
    offset: int,
    factory_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[Shift]:
    query = apply_filters(db.table("shifts").select("*"), factory_id=factory_id)
    query = apply_period(query, "start_at", date_from, date_to)
    rows = paginate(query.order("start_at", desc=True), limit, offset).execute().data
    return [Shift(**r) for r in rows]


def get_shift(db: Client, shift_id: int) -> Shift | None:
    row = get_by_id(db, "shifts", shift_id)
    return Shift(**row) if row else None
