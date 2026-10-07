from datetime import datetime

from supabase import Client

from app.schemas.enums import Criticality, EquipmentStatus
from app.schemas.factory import CarModel, Equipment, Factory, ProductionArea, Shift
from app.services.base import apply_filters, apply_period, get_by_id, paginate, safe_select

FALLBACK_FACTORIES = [{"id": 1, "name": "Автосборочный завод Allur", "location": "г. Костанай"}]
FALLBACK_CAR_MODELS = [
    {"id": 1, "factory_id": 1, "name": "Chevrolet Onix", "code": "CHEV-ONIX"},
    {"id": 2, "factory_id": 1, "name": "Chevrolet Cobalt", "code": "CHEV-COBALT"},
    {"id": 3, "factory_id": 1, "name": "JAC J7", "code": "JAC-J7"},
]
FALLBACK_AREAS = [
    {"id": 1, "factory_id": 1, "code": "WH-IN", "name": "Склад комплектующих", "sequence": 1},
    {"id": 2, "factory_id": 1, "code": "WELD", "name": "Сварка", "sequence": 2},
    {"id": 3, "factory_id": 1, "code": "PAINT", "name": "Окраска", "sequence": 3},
    {"id": 4, "factory_id": 1, "code": "ASSY", "name": "Сборка", "sequence": 4},
    {"id": 5, "factory_id": 1, "code": "QC", "name": "Контроль качества", "sequence": 5},
    {"id": 6, "factory_id": 1, "code": "WH-OUT", "name": "Склад готовой продукции", "sequence": 6},
]
FALLBACK_EQUIPMENT = [
    {"id": 1, "factory_id": 1, "production_area_id": 4, "code": "ASM-CNV-03", "name": "Конвейер-03", "kind": "conveyor", "status": "breakdown", "criticality": "high"},
    {"id": 2, "factory_id": 1, "production_area_id": 3, "code": "PNT-CAB-02", "name": "Камера-02", "kind": "paint_cabin", "status": "maintenance", "criticality": "high"},
    {"id": 3, "factory_id": 1, "production_area_id": 2, "code": "WLD-ABB-04", "name": "ABB-04", "kind": "weld_robot", "status": "running", "criticality": "high"},
]
FALLBACK_SHIFTS = [
    {"id": 1, "factory_id": 1, "shift_number": 1, "start_at": "2026-10-02T08:00:00+05:00", "end_at": "2026-10-02T16:00:00+05:00"}
]


def list_factories(db: Client) -> list[Factory]:
    rows = safe_select(db.table("factories").select("*").order("id"), FALLBACK_FACTORIES)
    return [Factory(**r) for r in rows]


def get_factory(db: Client, factory_id: int) -> Factory | None:
    row = get_by_id(db, "factories", factory_id)
    if not row and factory_id == 1:
        row = FALLBACK_FACTORIES[0]
    return Factory(**row) if row else None


def list_car_models(db: Client) -> list[CarModel]:
    rows = safe_select(db.table("car_models").select("*").order("id"), FALLBACK_CAR_MODELS)
    return [CarModel(**r) for r in rows]


def get_car_model(db: Client, car_model_id: int) -> CarModel | None:
    row = get_by_id(db, "car_models", car_model_id)
    if not row:
        row = next((m for m in FALLBACK_CAR_MODELS if m["id"] == car_model_id), None)
    return CarModel(**row) if row else None


def list_production_areas(db: Client, factory_id: int | None = None) -> list[ProductionArea]:
    query = apply_filters(db.table("production_areas").select("*"), factory_id=factory_id)
    rows = safe_select(query.order("sequence"), FALLBACK_AREAS)
    return [ProductionArea(**r) for r in rows]


def get_production_area(db: Client, area_id: int) -> ProductionArea | None:
    row = get_by_id(db, "production_areas", area_id)
    if not row:
        row = next((a for a in FALLBACK_AREAS if a["id"] == area_id), None)
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
    rows = safe_select(query.order("id"), FALLBACK_EQUIPMENT)
    return [Equipment(**r) for r in rows]


def get_equipment(db: Client, equipment_id: int) -> Equipment | None:
    row = get_by_id(db, "equipment", equipment_id)
    if not row:
        row = next((e for e in FALLBACK_EQUIPMENT if e["id"] == equipment_id), None)
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
    rows = safe_select(paginate(query.order("start_at", desc=True), limit, offset), FALLBACK_SHIFTS)
    return [Shift(**r) for r in rows]


def get_shift(db: Client, shift_id: int) -> Shift | None:
    row = get_by_id(db, "shifts", shift_id)
    if not row and shift_id == 1:
        row = FALLBACK_SHIFTS[0]
    return Shift(**row) if row else None
