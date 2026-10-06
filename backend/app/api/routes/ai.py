from fastapi import APIRouter
from app.services.ai_engine import ai_engine
from app.schemas.ai import (
    EquipmentPredictionResponse, AiForecastSummaryResponse,
    ConveyorTelemetryRequest, PaintTelemetryRequest,
    CopilotChatRequest, CopilotChatResponse,
    HarnessEvaluationReport
)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/forecast", response_model=AiForecastSummaryResponse, summary="Сводный предиктивный прогноз рисков завода Allur")
def get_ai_forecast():
    """
    Возвращает перечень предиктивных алертов, анализ узких мест
    и оценку угроз по оборудованию Allur (ISO 10816 + Anomaly Detection).
    """
    return ai_engine.get_forecast_summary()


@router.post("/predict-conveyor", response_model=EquipmentPredictionResponse, summary="Предиктивная вибродиагностика Конвейера-03")
def predict_conveyor(telemetry: ConveyorTelemetryRequest):
    """
    Анализирует СКЗ виброскорости, температуру редуктора и наработку Конвейера-03 сборки.
    Предотвращает аварию на 55 минут с экономией 4.67 млн ₸.
    """
    return ai_engine.predict_conveyor_failure(telemetry)


@router.post("/predict-paint", response_model=EquipmentPredictionResponse, summary="Прогнозирование брака ЛКП в Окрасочной камере-02")
def predict_paint(telemetry: PaintTelemetryRequest):
    """
    Анализирует температуру сушки, вязкость эмали и влажность.
    Предотвращает брак ЛКП до выхода кузова из сушильной печи.
    """
    return ai_engine.predict_paint_quality_scrap(telemetry)


@router.post("/copilot/chat", response_model=CopilotChatResponse, summary="Интерактивный диалог с AI Copilot завода Allur")
def chat_with_copilot(req: CopilotChatRequest):
    """
    Полноценная коммуникация с ИИ:
    - Контекстные ответы по цехам завода, инцидентам и метрикам OEE
    - Выявление корневых причин (Explainable AI)
    - Пошаговые предписания для ремонтных бригад
    - Оценка финансового эффекта в тенге и предложение сценариев What-If
    """
    return ai_engine.chat_with_copilot(req)


@router.get("/harness/evaluate", response_model=HarnessEvaluationReport, summary="AI Evaluation Harness (Бенчмарк и оценка качества модели)")
def run_evaluation_harness():
    """
    Прогоняет тестовый харнесс из калиброванных промышленных сценариев.
    Вычисляет Accuracy, Precision, Recall, F1-score и среднюю задержку инференса.
    """
    return ai_engine.run_harness_evaluation()
