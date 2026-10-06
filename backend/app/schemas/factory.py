from datetime import datetime

from pydantic import BaseModel

from app.schemas.enums import Criticality, EquipmentStatus


class Factory(BaseModel):
    id: int
    name: str
    location: str | None = None
    created_at: datetime


class CarModel(BaseModel):
    id: int
    name: str
    code: str
    created_at: datetime


class ProductionArea(BaseModel):
    id: int
    factory_id: int
    name: str
    code: str
    sequence: int


class Equipment(BaseModel):
    id: int
    production_area_id: int
    name: str
    code: str
    status: EquipmentStatus
    criticality: Criticality


class Shift(BaseModel):
    id: int
    factory_id: int
    name: str
    start_at: datetime
    end_at: datetime
