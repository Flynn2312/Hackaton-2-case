from typing import Dict, Any, List, Optional
from supabase import Client
from app.schemas.analytics import (
    PlantOeeResponse, AreaOee, BusinessEffectResponse, FinancialBreakdownItem,
    WhatIfSimulationRequest, WhatIfSimulationResponse
)
from app.services.case_data import (
    SHIFT_MINUTES, TARGET_OEE, MAX_CRITICAL_DOWNTIME_MIN, MAX_DEFECT_PCT,
    PRODUCTION, DOWNTIME, QUALITY
)


# Себестоимость простоя и брака (в тенге) — экспертные допущения модели
HOURLY_DOWNTIME_COST_KZT = 5_100_000   # 5.1 млн тенге / час
MINUTE_DOWNTIME_COST_KZT = 85_000      # 85 000 тенге / минута
REWORK_COST_PER_BODY_KZT = 120_000     # 120 тыс тенге перекрас 1 кузова
MARGIN_PER_VEHICLE_KZT = 1_450_000     # Маржинальный доход на 1 авто (Onix / Cobalt)
PLATFORM_CAPEX_KZT = 85_000_000        # Затраты на развертывание пилота (Edge + OPC UA)
ANNUAL_OPEX_KZT = 20_000_000           # Годовое обслуживание


def clamp(val: float, low: float, high: float) -> float:
    return max(low, min(high, val))


class AnalyticsService:

    @staticmethod
    def get_plant_oee(db: Optional[Client] = None, shift_id: Optional[int] = None) -> PlantOeeResponse:
        """
        Расчет сквозного OEE и метрик производственных участков:
        OEE = Availability * Performance * Quality
        Данные синхронизированы с официальным кейсом за 02.10.2026.
        """
        # Официальные данные за 02.10.2026:
        # Сварка: 111 факт, 91% загрузка, 30 мин простой (ABB-04), 2.7% брак (3 шт)
        # Окраска: 116 факт, 96% загрузка, 40 мин простой (Камера-02), 5.2% брак (6 шт)
        # Сборка: 119 факт, 99% загрузка, 55 мин простой (Конвейер-03), 1.7% брак (2 шт)
        areas_data = [
            {"id": 1, "name": "Склад комплектующих", "code": "WH-IN", "plan": 120, "fact": 120, "load": 95.0, "downtime": 0, "scrap": 0.0},
            {"id": 2, "name": "Сварка", "code": "WELD", "plan": 120, "fact": 111, "load": 91.0, "downtime": 30, "scrap": 2.7},
            {"id": 3, "name": "Окраска", "code": "PAINT", "plan": 120, "fact": 116, "load": 96.0, "downtime": 40, "scrap": 5.2},
            {"id": 4, "name": "Сборка", "code": "ASSY", "plan": 120, "fact": 119, "load": 99.0, "downtime": 55, "scrap": 1.7},
            {"id": 5, "name": "Контроль качества", "code": "QC", "plan": 120, "fact": 117, "load": 95.0, "downtime": 5, "scrap": 0.5},
            {"id": 6, "name": "Склад готовой продукции", "code": "WH-OUT", "plan": 120, "fact": 117, "load": 95.0, "downtime": 0, "scrap": 0.0},
        ]

        if db:
            try:
                prod_records = db.table("production_records").select("*").limit(200).execute().data
                if prod_records:
                    for a in areas_data:
                        area_prod = [r for r in prod_records if r.get("production_area_id") == a["id"]]
                        if area_prod:
                            a["fact"] = sum(r.get("actual_quantity", 0) for r in area_prod)
                            a["plan"] = sum(r.get("planned_quantity", 0) for r in area_prod)
                            loads = [r.get("load_percent", 90.0) for r in area_prod]
                            a["load"] = round(sum(loads) / len(loads), 1)
            except Exception:
                pass  # Fallback to calibrated test dataset

        calculated_areas: List[AreaOee] = []
        oee_values = []

        for a in areas_data:
            # 1. Доступность (Availability)
            avail = clamp(1.0 - (a["downtime"] / SHIFT_MINUTES), 0.5, 1.0)
            # 2. Производительность (Performance)
            perf = clamp(a["fact"] / max(1, a["plan"]), 0.5, 1.0)
            # 3. Качество (Quality)
            qual = clamp(1.0 - (a["scrap"] / 100.0), 0.5, 1.0)

            area_oee = round(avail * perf * qual * 100.0, 1)
            oee_values.append(area_oee)

            status = "ok"
            if a["downtime"] > 45 or a["scrap"] > 3.0 or area_oee < 80.0:
                status = "bad"
            elif a["downtime"] > 25 or a["scrap"] > MAX_DEFECT_PCT or area_oee < TARGET_OEE:
                status = "warn"

            calculated_areas.append(AreaOee(
                area_id=a["id"],
                area_name=a["name"],
                code=a["code"],
                planned_units=a["plan"],
                actual_units=a["fact"],
                load_percent=a["load"],
                downtime_minutes=a["downtime"],
                scrap_percent=a["scrap"],
                oee=area_oee,
                status=status
            ))

        # Средний OEE технологических участков (Сварка, Окраска, Сборка, Контроль качества)
        main_areas = calculated_areas[1:5]
        overall_oee = round(sum(a.oee for a in main_areas) / len(main_areas), 1)
        overall_status = "ok" if overall_oee >= TARGET_OEE else ("warn" if overall_oee >= 75.0 else "bad")

        worst_area = min(main_areas, key=lambda x: x.oee)

        return PlantOeeResponse(
            factory_name="АО «Группа компаний АЛЛЮР» (Костанай)",
            target_oee=TARGET_OEE,
            actual_oee=overall_oee,
            status=overall_status,
            shift_hours=8,
            areas=calculated_areas,
            bottleneck_area=f"{worst_area.area_name} (OEE: {worst_area.oee}%, Брак: {worst_area.scrap_percent}%, Простой: {worst_area.downtime_minutes} мин)",
            summary=f"Текущий OEE {overall_oee}% (норматив {TARGET_OEE}%). Узкие места: {worst_area.area_name} (OEE {worst_area.oee}%), Окраска (брак 5.2%) и Конвейер-03 (простой 55 мин)."
        )

    @staticmethod
    def get_business_effect() -> BusinessEffectResponse:
        """
        Финансово-экономическая модель окупаемости цифрового двойника Allur:
        ~1.2 млрд тенге годового эффекта при окупаемости менее 1 месяца (чистый срок 0.9 мес).
        """
        downtime_savings = 145 * HOURLY_DOWNTIME_COST_KZT  # 739 500 000 ₸
        scrap_savings = 930 * REWORK_COST_PER_BODY_KZT     # 111 600 000 ₸
        throughput_gain = 240 * MARGIN_PER_VEHICLE_KZT     # 348 000 000 ₸

        total_annual_kzt = downtime_savings + scrap_savings + throughput_gain  # 1 199 100 000 ₸
        # Чистый срок окупаемости с учетом годового OPEX:
        net_annual_kzt = max(1, total_annual_kzt - ANNUAL_OPEX_KZT)
        payback_months = round(PLATFORM_CAPEX_KZT / (net_annual_kzt / 12.0), 1)

        breakdown = [
            FinancialBreakdownItem(
                category="Сокращение аварийных простоев оборудования (-18.5%)",
                physical_metric="145 сэкономленных часов работы конвейера сборки",
                annual_savings_kzt=downtime_savings,
                share_percent=round((downtime_savings / total_annual_kzt) * 100, 1)
            ),
            FinancialBreakdownItem(
                category="Снижение дефектов лакокрасочного покрытия (ЛКП)",
                physical_metric="930 кузовов спасены от повторного перекраса",
                annual_savings_kzt=scrap_savings,
                share_percent=round((scrap_savings / total_annual_kzt) * 100, 1)
            ),
            FinancialBreakdownItem(
                category="Дополнительный выпуск автомобилей (устранение голодания сборки)",
                physical_metric="+240 готовых автомобилей (Chevrolet Onix / Cobalt)",
                annual_savings_kzt=throughput_gain,
                share_percent=round((throughput_gain / total_annual_kzt) * 100, 1)
            ),
        ]

        return BusinessEffectResponse(
            factory="Автосборочный завод Allur (г. Костанай)",
            currency="KZT (Тенге)",
            annual_economic_effect_kzt=total_annual_kzt,
            annual_economic_effect_str="~1.2 миллиарда тенге в год",
            payback_period_months=payback_months,
            capex_kzt=PLATFORM_CAPEX_KZT,
            annual_opex_kzt=ANNUAL_OPEX_KZT,
            hourly_downtime_cost_kzt=HOURLY_DOWNTIME_COST_KZT,
            minute_downtime_cost_kzt=MINUTE_DOWNTIME_COST_KZT,
            breakdown=breakdown,
            justification=f"Оценка базируется на нормативах такта Allur (4 мин/кузов), стоимости перекраса кузова 120 000 ₸ и маржинальности 1.45 млн ₸ на автомобиль. Решение окупается за {payback_months} месяца (CAPEX 85 млн ₸, OPEX 20 млн ₸/год)."
        )

    @staticmethod
    def simulate_what_if(req: WhatIfSimulationRequest) -> WhatIfSimulationResponse:
        """
        Сценарное моделирование превентивных решений What-If с физическим пересчетом метрик.
        """
        # Базовый OEE берем из актуальной модели завода
        base_status = AnalyticsService.get_plant_oee()
        original_oee = base_status.actual_oee

        # Валидация сценария и входных параметров
        valid_scenarios = {"conveyor_predictive", "paint_stabilization", "conveyor_and_paint"}
        has_negative = (req.downtime_reduction_minutes is not None and req.downtime_reduction_minutes < 0) or \
                       (req.quality_boost_percent is not None and req.quality_boost_percent < 0)

        if (req.scenario not in valid_scenarios) or has_negative:
            return WhatIfSimulationResponse(
                scenario_title="Ошибка валидации сценария",
                original_oee=original_oee,
                simulated_oee=original_oee,
                oee_delta=0.0,
                downtime_saved_minutes=0,
                quality_delta_percent=0.0,
                shift_economic_gain_kzt=0,
                status="error",
                details=f"Недопустимый сценарий '{req.scenario}' или отрицательные параметры (минуты: {req.downtime_reduction_minutes}, качество: {req.quality_boost_percent})."
            )

        # Корректная обработка значений: None -> дефолт, иначе число
        downtime_reduction = 43 if req.downtime_reduction_minutes is None else max(0, req.downtime_reduction_minutes)
        quality_delta = 3.9 if req.quality_boost_percent is None else max(0.0, req.quality_boost_percent)

        scenario = req.scenario or "conveyor_and_paint"

        if scenario == "conveyor_predictive":
            title = "Превентивное ТО Конвейера-03 сборки"
            # Сокращение простоя конвейера сборки на downtime_reduction мин
            # Прибавка OEE сборки: + (downtime_reduction / 480) * 100
            # Вклад в общий OEE (1/4 веса):
            oee_gain = round((downtime_reduction / 480.0) * 25.0, 1)
            simulated_oee = round(min(99.0, original_oee + oee_gain), 1)
            shift_gain = int(downtime_reduction * MINUTE_DOWNTIME_COST_KZT)
            details = f"Предотвращение аварийного простоя Конвейера-03 на {downtime_reduction} мин. Сэкономлено {shift_gain:,.0f} ₸ за смену."

        elif scenario == "paint_stabilization":
            title = "Стабилизация микроклимата Камеры окраски-02"
            # Снижение брака окраски на quality_delta %
            oee_gain = round((quality_delta / 100.0) * 25.0, 1)
            simulated_oee = round(min(99.0, original_oee + oee_gain), 1)
            saved_bodies = int(round(120 * (quality_delta / 100.0)))
            shift_gain = int(saved_bodies * REWORK_COST_PER_BODY_KZT)
            details = f"Снижение брака ЛКП на {quality_delta:.1f}%. Сохранено {saved_bodies} кузовов от перекраса (экономия {shift_gain:,.0f} ₸)."

        else:
            title = "Комплексная оптимизация завода Allur"
            conveyor_gain = (downtime_reduction / 480.0) * 25.0
            paint_gain = (quality_delta / 100.0) * 25.0
            oee_gain = round(conveyor_gain + paint_gain, 1)
            simulated_oee = round(min(99.0, original_oee + oee_gain), 1)
            saved_bodies = int(round(120 * (quality_delta / 100.0)))
            shift_gain = int(downtime_reduction * MINUTE_DOWNTIME_COST_KZT + saved_bodies * REWORK_COST_PER_BODY_KZT)
            details = f"Комплексный предиктивный эффект: экономия {downtime_reduction} мин простоя сборки и снижение брака окраски на {quality_delta:.1f}%. Суммарная выгода: {shift_gain:,.0f} ₸ за смену."

        return WhatIfSimulationResponse(
            scenario_title=title,
            original_oee=original_oee,
            simulated_oee=simulated_oee,
            oee_delta=round(simulated_oee - original_oee, 1),
            downtime_saved_minutes=downtime_reduction,
            quality_delta_percent=quality_delta,
            shift_economic_gain_kzt=shift_gain,
            status="success",
            details=details
        )
