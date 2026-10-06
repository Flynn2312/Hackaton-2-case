from datetime import datetime

from fastapi import APIRouter

from app.api.deps import DB, Page
from app.schemas.production import ProductionPlan, ProductionRecord, QualityRecord
from app.services import production as service

router = APIRouter()


@router.get("/production-plans", response_model=list[ProductionPlan], tags=["production plans"])
def list_production_plans(
    db: DB,
    page: Page,
    factory_id: int | None = None,
    shift_id: int | None = None,
    car_model_id: int | None = None,
):
    return service.list_production_plans(db, page.limit, page.offset, factory_id, shift_id, car_model_id)


@router.get("/production-records", response_model=list[ProductionRecord], tags=["production records"])
def list_production_records(
    db: DB,
    page: Page,
    shift_id: int | None = None,
    production_area_id: int | None = None,
    car_model_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    return service.list_production_records(
        db, page.limit, page.offset, shift_id, production_area_id, car_model_id, date_from, date_to
    )


@router.get("/quality-records", response_model=list[QualityRecord], tags=["quality records"])
def list_quality_records(
    db: DB,
    page: Page,
    shift_id: int | None = None,
    production_area_id: int | None = None,
    car_model_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    return service.list_quality_records(
        db, page.limit, page.offset, shift_id, production_area_id, car_model_id, date_from, date_to
    )
