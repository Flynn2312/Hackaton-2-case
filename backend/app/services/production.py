from datetime import datetime

from supabase import Client

from app.schemas.production import ProductionPlan, ProductionRecord, QualityRecord
from app.services.base import apply_filters, apply_period, paginate, safe_select

FALLBACK_PLANS = [
    {"id": 1, "factory_id": 1, "shift_id": 1, "car_model_id": 1, "planned_quantity": 2500},
    {"id": 2, "factory_id": 1, "shift_id": 1, "car_model_id": 2, "planned_quantity": 1800},
    {"id": 3, "factory_id": 1, "shift_id": 1, "car_model_id": 3, "planned_quantity": 500},
]

FALLBACK_PROD_RECORDS = [
    {"id": 1, "shift_id": 1, "production_area_id": 2, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "planned_quantity": 120, "actual_quantity": 111, "runtime_minutes": 432, "load_percent": 91.0},
    {"id": 2, "shift_id": 1, "production_area_id": 3, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "planned_quantity": 120, "actual_quantity": 116, "runtime_minutes": 462, "load_percent": 96.0},
    {"id": 3, "shift_id": 1, "production_area_id": 4, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "planned_quantity": 120, "actual_quantity": 119, "runtime_minutes": 474, "load_percent": 99.0},
]

FALLBACK_QUALITY_RECORDS = [
    {"id": 1, "shift_id": 1, "production_area_id": 2, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "total_quantity": 114, "good_quantity": 111, "scrap_quantity": 3, "rework_quantity": 0},
    {"id": 2, "shift_id": 1, "production_area_id": 3, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "total_quantity": 122, "good_quantity": 116, "scrap_quantity": 6, "rework_quantity": 0},
    {"id": 3, "shift_id": 1, "production_area_id": 4, "car_model_id": 1, "timestamp": "2026-10-02T16:00:00+05:00", "total_quantity": 121, "good_quantity": 119, "scrap_quantity": 2, "rework_quantity": 0},
]


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
    rows = safe_select(paginate(query.order("id", desc=True), limit, offset), FALLBACK_PLANS)
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
    rows = safe_select(paginate(query, limit, offset), FALLBACK_PROD_RECORDS)
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
    rows = safe_select(paginate(query, limit, offset), FALLBACK_QUALITY_RECORDS)
    return [QualityRecord(**r) for r in rows]
