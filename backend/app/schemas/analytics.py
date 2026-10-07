from pydantic import BaseModel
from typing import List, Optional, Dict, Any


class OeeComponent(BaseModel):
    availability: float
    performance: float
    quality: float
    oee: float
    status: str  # "ok" | "warn" | "bad"


class AreaOee(BaseModel):
    area_id: int
    area_name: str
    code: str
    planned_units: int
    actual_units: int
    load_percent: float
    downtime_minutes: int
    scrap_percent: float
    oee: float
    status: str


class PlantOeeResponse(BaseModel):
    factory_name: str
    target_oee: float
    actual_oee: float
    status: str
    shift_hours: int
    areas: List[AreaOee]
    bottleneck_area: str
    summary: str


class FinancialBreakdownItem(BaseModel):
    category: str
    physical_metric: str
    annual_savings_kzt: int
    share_percent: float


class BusinessEffectResponse(BaseModel):
    factory: str
    currency: str
    annual_economic_effect_kzt: int
    annual_economic_effect_str: str
    payback_period_months: float
    capex_kzt: int
    annual_opex_kzt: int
    hourly_downtime_cost_kzt: int
    minute_downtime_cost_kzt: int
    breakdown: List[FinancialBreakdownItem]
    justification: str


class WhatIfSimulationRequest(BaseModel):
    scenario: str = "conveyor_and_paint"  # "conveyor_predictive" | "paint_stabilization" | "conveyor_and_paint"
    downtime_reduction_minutes: Optional[int] = None
    quality_boost_percent: Optional[float] = None


class WhatIfSimulationResponse(BaseModel):
    scenario_title: str
    original_oee: float
    simulated_oee: float
    oee_delta: float
    downtime_saved_minutes: int
    quality_delta_percent: float
    shift_economic_gain_kzt: int
    status: str
    details: str
