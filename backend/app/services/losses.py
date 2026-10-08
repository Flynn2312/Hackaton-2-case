"""Расчёт выпуска и потерь по участкам.

Чистые функции без БД: их можно вызывать из API, whatif.py и тестов.

Баланс потерь (в автомобилях) сходится ровно:
    план − годные = потери_простой + потери_скорость + брак

    идеал       = план                       (план = идеальная скорость × 480 мин)
    простой     = ставка × (480 − время_работы)
    скорость    = ставка × время_работы − факт   (может быть < 0, если работали быстрее нормы)
    брак        = дефектные кузова
    годные      = факт − брак
где ставка = план / 480 авто/мин. Здесь факт — всего произведено (до отбраковки),
как в line_kpi() из case_data.py.

Деньги (допущения команды, те же, что на фронте: model.js → ECON):
    недовыпуск (простой + скорость) × маржа с авто 350 000 ₸
    брак × 120 000 ₸ (исправление кузова, он не теряется, его доделывают)
Минуту простоя дополнительно в тенге не считаем, иначе потеря будет учтена дважды.
"""
from __future__ import annotations

from typing import Iterable

SHIFT_MINUTES = 480
CAR_MARGIN_KZT = 350_000      # = ECON.carMarginKzt на фронте и CAR_MARGIN_KZT в simulator/forecast.py
REWORK_COST_KZT = 120_000     # = ECON.defectKzt на фронте


def line_losses(plan: float, fact: float, runtime_h: float, defects: float = 0,
                shift_min: int = SHIFT_MINUTES) -> dict:
    """Выпуск и потери одной линии за смену."""
    if plan <= 0 or shift_min <= 0:
        raise ValueError("plan и shift_min должны быть > 0")
    runtime_min = max(0.0, min(runtime_h * 60, shift_min))
    rate = plan / shift_min                              # авто/мин
    downtime_min = shift_min - runtime_min

    downtime_units = rate * downtime_min
    speed_units = rate * runtime_min - fact
    good = fact - defects

    lost_units = downtime_units + speed_units            # недовыпуск без учёта брака
    lost_money = max(0.0, lost_units) * CAR_MARGIN_KZT
    rework_money = defects * REWORK_COST_KZT

    return {
        "plan": plan, "fact": fact, "good": round(good, 1),
        "plan_pct": round(good / plan * 100, 1),         # выполнение плана по годным
        "gap_units": round(plan - good, 1),              # общий недовыпуск
        "loss_downtime_units": round(downtime_units, 1),
        "loss_speed_units": round(speed_units, 1),
        "loss_defect_units": round(defects, 1),
        "downtime_min": round(downtime_min, 1),
        "loss_money_kzt": round(lost_money),
        "rework_money_kzt": round(rework_money),
        "total_money_kzt": round(lost_money + rework_money),
    }


def plant_losses(lines: Iterable[dict]) -> dict:
    """Сводка по участкам. lines: [{area, plan, fact, runtime_h, defects}, ...]."""
    rows = [{"area": ln["area"], **line_losses(ln["plan"], ln["fact"], ln["runtime_h"], ln.get("defects", 0))}
            for ln in lines]
    if not rows:
        return {"areas": [], "bottleneck": None, "total_money_kzt": 0}
    worst = max(rows, key=lambda r: r["total_money_kzt"])
    return {
        "areas": rows,
        "bottleneck": worst["area"],                     # где потеряно больше всего денег
        "gap_units": round(sum(r["gap_units"] for r in rows), 1),
        "total_money_kzt": sum(r["total_money_kzt"] for r in rows),
    }


def losses_for_date(date: str) -> dict:
    """Те же расчёты по данным кейса (case_data.py) за дату вида '01.10.2026'."""
    from app.services import case_data as cd
    lines = []
    for area in cd.LINE_AREAS:
        p, q = cd.production(date, area), cd.quality(date, area)
        if p and q:
            lines.append({"area": area, "plan": p["plan"], "fact": p["fact"],
                          "runtime_h": p["runtime_h"], "defects": q["defects"]})
    return plant_losses(lines)