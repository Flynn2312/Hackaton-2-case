from datetime import datetime

from pydantic import BaseModel


class ProductionPlan(BaseModel):
    id: int
    factory_id: int
    shift_id: int
    car_model_id: int
    planned_quantity: int


class ProductionRecord(BaseModel):
    id: int
    shift_id: int
    production_area_id: int
    car_model_id: int
    timestamp: datetime
    planned_quantity: int
    actual_quantity: int
    runtime_minutes: int
    load_percent: float


class QualityRecord(BaseModel):
    id: int
    shift_id: int
    production_area_id: int
    car_model_id: int
    timestamp: datetime
    total_quantity: int
    good_quantity: int
    scrap_quantity: int
    rework_quantity: int
