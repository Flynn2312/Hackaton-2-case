"""
Единый источник данных Кейса №2 «Цифровой двойник автозавода Allur».

Все цифры ниже — ДОСЛОВНО из файла «Кейс_Цифровой_двойник_Тестовые_данные.docx».
Любые аналитические сервисы (OEE, What-If, Copilot, прогноз, бизнес-эффект)
обязаны брать данные отсюда, чтобы на дашборде, в API и в чате была одна «истина».

Допущения команды (то, чего нет в кейсе) собраны в ASSUMPTIONS и явно
помечены — их нужно уточнить у Allur при пилоте.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ── Нормативы из «Дополнительных вводных» кейса ──────────────────────────
SHIFTS_PER_DAY = 2
SHIFT_HOURS = 8.0
SHIFT_MINUTES = int(SHIFT_HOURS * 60)
TARGET_OEE = 85.0                 # %
MAX_DEFECT_PCT = 2.0              # %
MAX_CRITICAL_DOWNTIME_MIN = 60    # мин/сутки на единицу критичного оборудования
MONTHLY_PLAN_TARGET = 5500        # авто/мес

FLOW = [
    "Склад комплектующих", "Сварка", "Окраска", "Сборка",
    "Контроль качества", "Склад готовой продукции",
]
AREA_CODES = {
    "Склад комплектующих": "WH-IN", "Сварка": "WELD", "Окраска": "PAINT",
    "Сборка": "ASSY", "Контроль качества": "QC", "Склад готовой продукции": "WH-OUT",
}

# ── 1. Работа производственных линий ─────────────────────────────────────
PRODUCTION: List[Dict[str, Any]] = [
    {"date": "01.10.2026", "line": "Сварка-1", "area": "Сварка", "plan": 120, "fact": 118, "runtime_h": 7.8, "load_pct": 98},
    {"date": "01.10.2026", "line": "Окраска-1", "area": "Окраска", "plan": 120, "fact": 115, "runtime_h": 7.5, "load_pct": 94},
    {"date": "01.10.2026", "line": "Сборка-1", "area": "Сборка", "plan": 120, "fact": 121, "runtime_h": 8.0, "load_pct": 100},
    {"date": "02.10.2026", "line": "Сварка-1", "area": "Сварка", "plan": 120, "fact": 111, "runtime_h": 7.2, "load_pct": 91},
    {"date": "02.10.2026", "line": "Окраска-1", "area": "Окраска", "plan": 120, "fact": 116, "runtime_h": 7.7, "load_pct": 96},
    {"date": "02.10.2026", "line": "Сборка-1", "area": "Сборка", "plan": 120, "fact": 119, "runtime_h": 7.9, "load_pct": 99},
]

# ── 2. Статистика простоев оборудования ──────────────────────────────────
DOWNTIME: List[Dict[str, Any]] = [
    {"date": "01.10.2026", "area": "Сварка", "equipment": "ABB-01", "reason": "Ошибка датчика", "minutes": 25, "planned": False},
    {"date": "01.10.2026", "area": "Окраска", "equipment": "Камера-02", "reason": "Замена фильтра", "minutes": 40, "planned": False},
    {"date": "02.10.2026", "area": "Сборка", "equipment": "Конвейер-03", "reason": "Обрыв цепи", "minutes": 55, "planned": False},
    {"date": "02.10.2026", "area": "Сварка", "equipment": "ABB-04", "reason": "Плановое ТО", "minutes": 30, "planned": True},
]

# ── 3. Производственный план ─────────────────────────────────────────────
MODEL_PLAN: Dict[str, int] = {"Chevrolet Onix": 2500, "Chevrolet Cobalt": 1800, "JAC J7": 500}

# ── 4. Показатели качества ───────────────────────────────────────────────
QUALITY: List[Dict[str, Any]] = [
    {"date": "01.10.2026", "area": "Сварка", "produced": 118, "defects": 2, "defect_pct": 1.7},
    {"date": "01.10.2026", "area": "Окраска", "produced": 115, "defects": 4, "defect_pct": 3.5},
    {"date": "01.10.2026", "area": "Сборка", "produced": 121, "defects": 1, "defect_pct": 0.8},
    {"date": "02.10.2026", "area": "Сварка", "produced": 111, "defects": 3, "defect_pct": 2.7},
    {"date": "02.10.2026", "area": "Окраска", "produced": 116, "defects": 6, "defect_pct": 5.2},
    {"date": "02.10.2026", "area": "Сборка", "produced": 119, "defects": 2, "defect_pct": 1.7},
]

DATES = sorted({r["date"] for r in PRODUCTION}, key=lambda d: d.split(".")[::-1])
LATEST_DATE = DATES[-1]
LINE_AREAS = ["Сварка", "Окраска", "Сборка"]

# ── Допущения команды (НЕТ в кейсе, уточнить у Allur) ────────────────────
ASSUMPTIONS: Dict[str, Dict[str, Any]] = {
    "work_days_per_year": {"value": 250, "note": "5-дневная неделя за вычетом праздников РК"},
    "minute_downtime_cost_kzt": {"value": 85_000, "note": "стоимость минуты простоя линии (ФОТ + накладные + упущенная маржа)"},
    "rework_cost_per_defect_kzt": {"value": 120_000, "note": "средняя стоимость исправления одного дефектного кузова"},
    "pdm_unplanned_downtime_reduction": {"value": 0.30, "note": "снижение внеплановых простоев за счет предиктивного ТО (отраслевой диапазон 30–50%, берем нижнюю границу)"},
    "capex_kzt": {"value": 85_000_000, "note": "пилот: edge-шлюзы, OPC UA, датчики вибрации/температуры, внедрение"},
    "annual_opex_kzt": {"value": 20_000_000, "note": "сопровождение, хостинг, лицензии"},
    "ideal_rate_basis": {"value": "plan/8h", "note": "паспортного такта в кейсе нет — идеальная скорость = план смены / 8 ч"},
}


def A(key: str) -> Any:
    return ASSUMPTIONS[key]["value"]


# ─────────────────────────────── Выборки ────────────────────────────────
def production(date: str, area: str) -> Optional[Dict[str, Any]]:
    return next((r for r in PRODUCTION if r["date"] == date and r["area"] == area), None)


def quality(date: str, area: str) -> Optional[Dict[str, Any]]:
    return next((r for r in QUALITY if r["date"] == date and r["area"] == area), None)


def downtime_events(date: Optional[str] = None, area: Optional[str] = None) -> List[Dict[str, Any]]:
    return [d for d in DOWNTIME if (date is None or d["date"] == date) and (area is None or d["area"] == area)]


# ─────────────────────────────── KPI ────────────────────────────────────
def line_kpi(date: str, area: str, recovered_minutes: float = 0.0, defect_pct_reduction: float = 0.0) -> Optional[Dict[str, Any]]:
    """
    OEE = Availability × Performance × Quality (классическое определение).
      A = время работы / 480 мин
      P = факт / (идеальная скорость × время работы), идеальная скорость = план / 480 мин; P ограничен 1.0
      Q = (факт − брак) / факт
    recovered_minutes / defect_pct_reduction — для What-If.
    """
    p = production(date, area)
    q = quality(date, area)
    if not p or not q:
        return None
    runtime_min = p["runtime_h"] * 60
    lost_min = SHIFT_MINUTES - runtime_min
    recovered = max(0.0, min(recovered_minutes, lost_min))
    runtime_new = runtime_min + recovered

    rate = p["plan"] / SHIFT_MINUTES                       # авто/мин
    fact_new = p["fact"] * (runtime_new / runtime_min)     # при той же скорости
    perf_raw = fact_new / (rate * runtime_new)
    defect_pct = q["defects"] / q["produced"] * 100
    defect_new = max(0.0, defect_pct - max(0.0, defect_pct_reduction))

    a = runtime_new / SHIFT_MINUTES
    perf = min(1.0, perf_raw)
    qual = 1 - defect_new / 100
    oee = a * perf * qual * 100

    logged = sum(d["minutes"] for d in downtime_events(date, area))
    return {
        "date": date, "area": area, "line": p["line"],
        "plan": p["plan"], "fact": round(fact_new, 1) if recovered else p["fact"],
        "load_pct": p["load_pct"], "runtime_h": round(runtime_new / 60, 2),
        "availability": round(a * 100, 1), "performance": round(perf * 100, 1),
        "performance_raw": round(perf_raw * 100, 1), "quality": round(qual * 100, 1),
        "oee": round(oee, 1),
        "lost_minutes": round(lost_min - recovered, 1), "logged_downtime_minutes": logged,
        "defects": q["defects"], "defect_pct": round(defect_new, 2),
        "good_units": round(fact_new * qual, 1),
    }


def day_kpis(date: str = LATEST_DATE, overrides: Optional[Dict[str, Dict[str, float]]] = None) -> List[Dict[str, Any]]:
    overrides = overrides or {}
    out = []
    for area in LINE_AREAS:
        o = overrides.get(area, {})
        k = line_kpi(date, area, o.get("recovered_minutes", 0.0), o.get("defect_pct_reduction", 0.0))
        if k:
            out.append(k)
    return out


def plant_oee(date: Optional[str] = LATEST_DATE, overrides: Optional[Dict[str, Dict[str, float]]] = None) -> float:
    """Средний OEE трёх линий за дату (или за все даты, если date=None)."""
    dates = DATES if date is None else [date]
    vals = [k["oee"] for d in dates for k in day_kpis(d, overrides)]
    return round(sum(vals) / len(vals), 1)


def bottleneck(date: str = LATEST_DATE) -> Dict[str, Any]:
    return min(day_kpis(date), key=lambda k: k["oee"])


def worst_quality(date: str = LATEST_DATE) -> Dict[str, Any]:
    return max(day_kpis(date), key=lambda k: k["defect_pct"])


def defect_trend(area: str) -> List[float]:
    return [quality(d, area)["defect_pct"] for d in DATES if quality(d, area)]


def critical_equipment_load() -> List[Dict[str, Any]]:
    """Использование лимита 60 мин/сутки по каждой единице оборудования."""
    rows = []
    for d in DOWNTIME:
        rows.append({**d, "limit_used_pct": round(d["minutes"] / MAX_CRITICAL_DOWNTIME_MIN * 100, 1),
                     "margin_minutes": MAX_CRITICAL_DOWNTIME_MIN - d["minutes"]})
    return sorted(rows, key=lambda r: -r["minutes"])


def plan_gap() -> Dict[str, Any]:
    models_total = sum(MODEL_PLAN.values())
    plan_per_shift = PRODUCTION[0]["plan"]
    capacity_22 = plan_per_shift * SHIFTS_PER_DAY * 22
    return {
        "models_total": models_total,
        "target": MONTHLY_PLAN_TARGET,
        "gap": MONTHLY_PLAN_TARGET - models_total,
        "plan_per_shift": plan_per_shift,
        "capacity_22_days": capacity_22,
        "days_needed_for_target": round(MONTHLY_PLAN_TARGET / (plan_per_shift * SHIFTS_PER_DAY), 1),
    }


# ───────────────────────── Качество данных ──────────────────────────────
def data_quality_issues() -> List[Dict[str, Any]]:
    """Находит противоречия между источниками — то, что двойник должен подсвечивать."""
    issues: List[Dict[str, Any]] = []
    for p in PRODUCTION:
        lost = round(SHIFT_MINUTES - p["runtime_h"] * 60)
        logged = sum(d["minutes"] for d in downtime_events(p["date"], p["area"]))
        if abs(lost - logged) > 10:
            issues.append({
                "severity": "warning", "category": "Простои vs время работы",
                "date": p["date"], "area": p["area"],
                "message": f"{p['line']}: по времени работы потеряно {lost} мин, в журнале простоев {logged} мин",
                "evidence": f"время работы {p['runtime_h']} ч из 8 ч; журнал: "
                            + (", ".join(f"{d['equipment']} {d['minutes']} мин" for d in downtime_events(p['date'], p['area'])) or "записей нет"),
            })
        k = line_kpi(p["date"], p["area"])
        if k and k["performance_raw"] > 100.0:
            issues.append({
                "severity": "info", "category": "Такт / план",
                "date": p["date"], "area": p["area"],
                "message": f"{p['line']}: фактическая скорость выше плановой (P = {k['performance_raw']}%)",
                "evidence": "плановый такт занижен относительно реального — нужен паспортный такт линии",
            })
    for q in QUALITY:
        calc = round(q["defects"] / q["produced"] * 100, 1)
        if abs(calc - q["defect_pct"]) > 0.1:
            issues.append({"severity": "warning", "category": "Качество", "date": q["date"], "area": q["area"],
                           "message": f"% брака {q['defect_pct']} не совпадает с расчетом {calc}", "evidence": ""})
    for p in PRODUCTION:
        q = quality(p["date"], p["area"])
        if q and q["produced"] != p["fact"]:
            issues.append({"severity": "warning", "category": "Выпуск", "date": p["date"], "area": p["area"],
                           "message": f"выпуск в качестве {q['produced']} ≠ факт линии {p['fact']}", "evidence": ""})
    g = plan_gap()
    if g["gap"] > 0:
        issues.append({
            "severity": "critical", "category": "План",
            "date": "10.2026", "area": "Завод",
            "message": f"План по моделям {g['models_total']} авто < цели {g['target']} авто/мес (дефицит {g['gap']})",
            "evidence": f"Onix {MODEL_PLAN['Chevrolet Onix']} + Cobalt {MODEL_PLAN['Chevrolet Cobalt']} + JAC J7 {MODEL_PLAN['JAC J7']}; "
                        f"при {g['plan_per_shift']} авто/смену × 2 смены нужно {g['days_needed_for_target']} рабочих дней без потерь",
        })
    return issues
