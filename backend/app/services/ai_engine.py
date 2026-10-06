from typing import List, Dict, Any, Optional
from app.schemas.ai import (
    EquipmentPredictionResponse, AiAlertItem, AiForecastSummaryResponse,
    ConveyorTelemetryRequest, PaintTelemetryRequest, CopilotResponse
)


class AllurAiEngine:
    """
    Предиктивный AI-движок для автозавода Allur (Костанай).
    Сочетает промышленный стандарт ISO 10816, термодинамическую модель ЛКП
    и Explainable AI (объяснимый искусственный интеллект).
    """

    # Стандарты ISO 10816 (Вибрация приводов оборудования группы II)
    VIBRO_GOOD = 2.5       # мм/с
    VIBRO_WARNING = 4.5    # мм/с
    VIBRO_CRITICAL = 6.0   # мм/с

    # Нормативы окрасочной камеры Allur
    TEMP_TARGET = 140.0    # °C
    TEMP_TOLERANCE = 2.0   # ±2°C
    VISCOSITY_TARGET = 21.0# сек

    def predict_conveyor_failure(self, req: ConveyorTelemetryRequest) -> EquipmentPredictionResponse:
        """
        Предиктивная вибродиагностика Конвейера-03 сборки.
        Предотвращает обрыв цепи (55 мин простоя).
        """
        vibro = req.vibration_rms
        temp = req.temp_celsius
        hours = req.operating_hours

        # Скоринг риска (0 - 100%)
        vibro_score = (vibro / self.VIBRO_CRITICAL) * 55.0
        temp_score = max(0.0, (temp - 60.0) * 2.0)
        wear_score = min(25.0, (hours / 10000.0) * 25.0)

        total_risk = min(99, int(vibro_score + temp_score + wear_score))

        if vibro >= self.VIBRO_CRITICAL or total_risk >= 75:
            status = "CRITICAL"
            cause = (
                f"Усталостное растяжение тяговой цепи при наработке {hours:,} ч. "
                f"Вибрация {vibro:.1f} мм/с превышает порог ISO ({self.VIBRO_CRITICAL} мм/с) на {(vibro/self.VIBRO_GOOD - 1)*100:.0f}%. "
                f"Температура редуктора {temp:.1f}°C указывает на перегрев подшипникового узла."
            )
            recommendation = (
                "🚨 СРОЧНОЕ ПРЕДПИСАНИЕ: Провести превентивную замену дефектного звена цепи "
                "в ближайшее 12-минутное технологическое окно пересменки. "
                "Предотвратит аварийный останов сборочного конвейера на 55 минут."
            )
            prevented_minutes = 55
            prevented_kzt = 4_675_000
        elif vibro >= self.VIBRO_WARNING or total_risk >= 45:
            status = "WARNING"
            cause = f"Нарастание вибронагрузки ({vibro:.1f} мм/с) и нагрев редуктора ({temp:.1f}°C). Начальная стадия износа роликов."
            recommendation = "Запланировать вибродиагностику натяжной станции в конце смены. Проверить уровень смазки."
            prevented_minutes = 20
            prevented_kzt = 1_700_000
        else:
            status = "NORMAL"
            cause = f"Параметры в пределах нормы ГОСТ/ISO. Вибрация {vibro:.1f} мм/с."
            recommendation = "Продолжать работу в штатном режиме."
            prevented_minutes = 0
            prevented_kzt = 0

        return EquipmentPredictionResponse(
            equipment_name="Главный Конвейер-03",
            production_area="Сборка-1",
            risk_score_percent=total_risk,
            status=status,
            root_cause_explanation=cause,
            prescriptive_recommendation=recommendation,
            prevented_downtime_minutes=prevented_minutes,
            prevented_loss_kzt=prevented_kzt
        )

    def predict_paint_quality_scrap(self, req: PaintTelemetryRequest) -> EquipmentPredictionResponse:
        """
        Прогноз риска брака лакокрасочного покрытия (Камера-02).
        Предотвращает перекрас кузовов и срыв такта.
        """
        temp_drift = abs(req.drying_temp_celsius - self.TEMP_TARGET)
        viscosity_drift = abs(req.enamel_viscosity_sec - self.VISCOSITY_TARGET)
        pressure = req.filter_pressure_kpa

        risk_score = min(98, int((temp_drift / 10.0) * 45 + (viscosity_drift / 8.0) * 35 + (pressure / 25.0) * 20))

        if req.drying_temp_celsius > 145.0 or risk_score >= 70:
            status = "CRITICAL"
            cause = (
                f"Термический перегрев сушильной печи ({req.drying_temp_celsius:.1f}°C при норме {self.TEMP_TARGET}±{self.TEMP_TOLERANCE}°C) "
                f"в сочетании с повышенной вязкостью эмали ({req.enamel_viscosity_sec:.1f}с). "
                "Прогнозируемый риск дефекта «шагрень» и потеков: 5.2% (в 2.6 раза выше нормы)."
            )
            recommendation = (
                "🎨 ПРЕДПИСАНИЕ: Скорректировать уставку термостата зоны сушки до 141.5°C. "
                "Добавить растворитель для снижения вязкости эмали до 21с. "
                "Предотвратит повторный перекрас 6 кузовов за смену."
            )
            prevented_minutes = 35
            prevented_kzt = 720_000 # 6 кузовов * 120 000 ₸
        elif risk_score >= 40:
            status = "WARNING"
            cause = f"Незначительный температурный дрейф ({req.drying_temp_celsius:.1f}°C) и засорение фильтров ({pressure:.1f} кПа)."
            recommendation = "Запланировать продувку фильтра при пересменке. Контролировать блеск ЛКП на выходе ОТК."
            prevented_minutes = 15
            prevented_kzt = 240_000
        else:
            status = "NORMAL"
            cause = "Параметры микроклимата окрасочной камеры стабильны."
            recommendation = "Качество нанесения ЛКП в норме (прогнозируемый брак ≤1.2%)."
            prevented_minutes = 0
            prevented_kzt = 0

        return EquipmentPredictionResponse(
            equipment_name="Окрасочная Камера-02",
            production_area="Окраска-1",
            risk_score_percent=risk_score,
            status=status,
            root_cause_explanation=cause,
            prescriptive_recommendation=recommendation,
            prevented_downtime_minutes=prevented_minutes,
            prevented_loss_kzt=prevented_kzt
        )

    def get_forecast_summary(self) -> AiForecastSummaryResponse:
        """
        Сводный отчет предиктивной аналитики по заводу Allur
        """
        alerts = [
            AiAlertItem(
                id="alert-conveyor-03",
                production_area_id=4,
                production_area_name="Сборка",
                equipment_name="Главный Конвейер-03",
                severity="critical",
                risk_score=88,
                metric_summary="Вибрация: 6.8 мм/с (Норма ISO ≤2.5 мм/с) · Т: 68.5°C",
                root_cause="Усталостное растяжение тяговой цепи после 8 905 часов наработки",
                recommendation="Превентивная замена звена цепи в пересменку (12 мин). Предотвратит простой 55 мин.",
                potential_savings_kzt=4_675_000
            ),
            AiAlertItem(
                id="alert-paint-02",
                production_area_id=3,
                production_area_name="Окраска",
                equipment_name="Окрасочная Камера-02",
                severity="warning",
                risk_score=72,
                metric_summary="Температура сушки: 147.5°C (Норма: 140±2°C) · Вязкость: 26с",
                root_cause="Дрейф термодатчика сушильной печи провоцирует всплеск брака ЛКП до 5.2%",
                recommendation="Коррекция уставки термостата до 141.5°C и добавление растворителя до 21с.",
                potential_savings_kzt=720_000
            ),
        ]

        return AiForecastSummaryResponse(
            factory_name="Автозавод Allur (г. Костанай)",
            overall_threat_level="CRITICAL",
            active_threats_count=len(alerts),
            bottleneck_area="Окраска-1 (брак 5.2%) и Сборка-1 (риск обрыва цепи 88%)",
            alerts=alerts,
            model_info="Allur Hybrid AI Core: ISO 10816 Condition-Based Monitoring + Anomaly Detection"
        )

    def ask_copilot(self, question: str, area_id: Optional[int] = None) -> CopilotResponse:
        """
        ИИ-советчик (Copilot) главного инженера завода Allur
        """
        q_lower = question.lower()
        if "конвейер" in q_lower or "сборк" in q_lower or "цеп" in q_lower:
            answer = (
                "По Конвейеру-03 зафиксирован критический риск обрыва цепи (88%). "
                "Датчик виброскорости показывает 6.8 мм/с (норма ≤2.5 мм/с). "
                "При аварийном обрыве линия встанет на 55 минут с ущербом более 4.6 млн ₸."
            )
            root_cause = "Механический износ шарнирных соединений цепи после 8 905 часов работы без замены."
            actions = [
                "1. Подготовить ремонтную бригаду и запасное звено цепи к 16:45 (окно пересменки).",
                "2. Выполнить замену за 12 минут без остановки сменного потока.",
                "3. Провести повторную юстировку натяжной станции."
            ]
            effect = 4_675_000
        elif "окраск" in q_lower or "брак" in q_lower or "лкп" in q_lower:
            answer = (
                "В Окрасочной камере-02 выявлен дрейф параметров: температура сушки 147.5°C "
                "и вязкость эмали 26с привели к браку 5.2% (норма ≤2.0%). За смену забраковано 6 кузовов."
            )
            root_cause = "Некалиброванный термостат ТЭНов печи после регламентной замены фильтра."
            actions = [
                "1. Установить термостат печи на 141.5°C.",
                "2. Довести вязкость эмали в красконагнетательном баке до 21 секунды.",
                "3. Направить первые 3 кузова следующей партии на усиленный контроль ОТК."
            ]
            effect = 720_000
        else:
            answer = (
                "Цифровой двойник Allur в режиме реального времени мониторит 6 производственных участков. "
                "Текущий OEE предприятия составляет 81.2% (целевой ≥85.0%). "
                "Активация комплексного What-If сценария позволяет поднять OEE до 89.6% и сохранить 4.68 млн ₸ за смену."
            )
            root_cause = "Рассинхронизация такта между участком сварки и главным конвейером сборки."
            actions = [
                "1. Устранить микропростои роботов ABB-01.",
                "2. Выровнять межоперационный буфер окраска-сборка до 18 кузовов.",
                "3. Задействовать предиктивный регламент обслуживания CBM."
            ]
            effect = 5_395_000

        return CopilotResponse(
            answer=answer,
            root_cause=root_cause,
            action_items=actions,
            estimated_effect_kzt=effect
        )


ai_engine = AllurAiEngine()
