from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any


class ConveyorTelemetryRequest(BaseModel):
    vibration_rms: float = Field(default=6.8, ge=0.0, le=100.0, description="СКЗ виброскорости привода, мм/с (норма ISO ≤2.5)")
    temp_celsius: float = Field(default=68.5, ge=-20.0, le=200.0, description="Температура редуктора, °C (норма ≤60)")
    operating_hours: int = Field(default=8905, ge=0, le=200000, description="Наработка тяговой цепи с момента капремонта, часов")


class PaintTelemetryRequest(BaseModel):
    drying_temp_celsius: float = Field(default=147.5, ge=0.0, le=300.0, description="Температура сушильной печи, °C (норма 140±2°C)")
    enamel_viscosity_sec: float = Field(default=26.0, ge=5.0, le=120.0, description="Вязкость эмали по ВЗ-4, сек (норма 20-22с)")
    relative_humidity_pct: float = Field(default=74.0, ge=0.0, le=100.0, description="Относительная влажность камеры, % (норма 60-70%)")
    filter_pressure_kpa: float = Field(default=18.5, ge=0.0, le=100.0, description="Перепад давления на фильтрах, кПа (норма ≤15 кПа)")


class EquipmentPredictionResponse(BaseModel):
    equipment_name: str
    production_area: str
    risk_score_percent: int
    status: str  # "NORMAL" | "WARNING" | "CRITICAL"
    root_cause_explanation: str
    prescriptive_recommendation: str
    prevented_downtime_minutes: int
    prevented_loss_kzt: int


class AiAlertItem(BaseModel):
    id: str
    production_area_id: int
    production_area_name: str
    equipment_name: str
    severity: str  # "warning" | "critical"
    risk_score: int
    metric_summary: str
    root_cause: str
    recommendation: str
    potential_savings_kzt: int


class AiForecastSummaryResponse(BaseModel):
    factory_name: str
    timestamp: Optional[str] = None
    overall_threat_level: str
    active_threats_count: int
    bottleneck_area: str
    alerts: List[AiAlertItem]
    model_info: str


class CopilotMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: Optional[str] = None


class CopilotChatRequest(BaseModel):
    message: Optional[str] = None
    question: Optional[str] = None
    history: Optional[List[CopilotMessage]] = []
    area_id: Optional[int] = None

    def get_query(self) -> str:
        return (self.message or self.question or "").strip()


class CopilotChatResponse(BaseModel):
    answer: str
    root_cause: Optional[str] = None
    action_items: List[str] = []
    estimated_effect_kzt: int = 0
    recommended_scenario_id: Optional[str] = None
    quick_suggestions: List[str] = []


class HarnessCaseResult(BaseModel):
    case_id: str
    name: str
    domain: str  # "conveyor_vibration" | "paint_quality" | "bottleneck_throughput"
    input_features: Dict[str, Any]
    expected_status: str
    predicted_status: str
    is_passed: bool
    latency_ms: float
    confidence_score: float
    diagnostic_message: str


class HarnessEvaluationReport(BaseModel):
    test_suite_name: str
    timestamp: str
    total_cases: int
    passed_cases: int
    failed_cases: int
    accuracy_percent: float
    precision_score: float
    recall_score: float
    f1_score: float
    mean_latency_ms: float
    benchmark_status: str  # "EXCELLENT" | "PASSED" | "FAILED"
    cases: List[HarnessCaseResult]
    summary_verdict: str
