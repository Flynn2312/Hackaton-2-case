from datetime import datetime

from supabase import Client

from app.schemas.production import ProductionPlan, ProductionRecord, QualityRecord
from app.services.base import apply_filters, apply_period, paginate


def list_production_plans(
    db: Client,
    limit: int,
    offset: int,
    factory_id: int | None = None,
    shift_id: int | None = None,
    car_model_id: int | None = None,
) -> list[ProductionPlan]:
    query = apply_filters(
        db.table("production_plans").select("*"),
        factory_id=factory_id, shift_id=shift_id, car_model_id=car_model_id,
    )
    rows = paginate(query.order("id", desc=True), limit, offset).execute().data
    return [ProductionPlan(**r) for r in rows]


def list_production_records(
    db: Client,
    limit: int,
    offset: int,
    shift_id: int | None = None,
    production_area_id: int | None = None,
    car_model_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[ProductionRecord]:
    query = apply_filters(
        db.table("production_records").select("*"),
        shift_id=shift_id, production_area_id=production_area_id, car_model_id=car_model_id,
    )
    query = apply_period(query, "timestamp", date_from, date_to)
    query = query.order("timestamp", desc=True).order("production_area_id")
    rows = paginate(query, limit, offset).execute().data
    return [ProductionRecord(**r) for r in rows]


def list_quality_records(
    db: Client,
    limit: int,
    offset: int,
    shift_id: int | None = None,
    production_area_id: int | None = None,
    car_model_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[QualityRecord]:
    query = apply_filters(
        db.table("quality_records").select("*"),
        shift_id=shift_id, production_area_id=production_area_id, car_model_id=car_model_id,
    )
    query = apply_period(query, "timestamp", date_from, date_to)
    query = query.order("timestamp", desc=True).order("production_area_id")
    rows = paginate(query, limit, offset).execute().data
    return [QualityRecord(**r) for r in rows]
