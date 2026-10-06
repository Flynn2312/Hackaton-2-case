from typing import Optional
from fastapi import APIRouter, Depends
from supabase import Client

from app.api.deps import DB
from app.services.analytics import AnalyticsService
from app.schemas.analytics import (
    PlantOeeResponse, BusinessEffectResponse,
    WhatIfSimulationRequest, WhatIfSimulationResponse
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/oee", response_model=PlantOeeResponse, summary="Расчет OEE завода и технологических участков")
@router.get("/plant-oee", response_model=PlantOeeResponse, summary="Алиас расчета OEE завода")
def get_plant_oee(shift_id: Optional[int] = None, db: DB = None):
    """
    Возвращает сквозной расчет OEE (Availability * Performance * Quality)
    по технологической цепочке: Склад -> Сварка -> Окраска -> Сборка -> ОТК -> Склад ГП.
    """
    return AnalyticsService.get_plant_oee(db=db, shift_id=shift_id)


@router.get("/business-effect", response_model=BusinessEffectResponse, summary="Экономический эффект внедрения для Allur (1.2 млрд ₸)")
def get_business_effect():
    """
    Возвращает экономическое обоснование для АО «Allur»:
    годовой эффект 1.2 млрд ₸, срок окупаемости 2.8 мес, структура экономии.
    """
    return AnalyticsService.get_business_effect()


@router.post("/what-if", response_model=WhatIfSimulationResponse, summary="Сценарный тренажер What-If для моделирования решений")
def run_what_if_simulation(request: WhatIfSimulationRequest):
    """
    Моделирует управленческие сценарии: превентивная замена цепи Конвейера-03,
    стабилизация температуры окраски, комплексная оптимизация смены.
    """
    return AnalyticsService.simulate_what_if(request)


@router.get("/data-quality", summary="Аудит расхождений и коллизий производственных данных")
def get_data_quality_audit():
    """
    Автоматический аудит коллизий данных Allur:
    - Несовпадение потерь времени работы с журналом аварийных простоев
    - Дефицит месячного плана выпуска по моделям относительно норматива завода (5 500 авто)
    - Опережение нормативного такта на финишной линии сборки
    """
    from app.services.case_data import data_quality_issues
    return {
        "status": "success",
        "factory": "АО «Группа компаний АЛЛЮР»",
        "total_issues": len(data_quality_issues()),
        "issues": data_quality_issues()
    }
