"""
Генерация и загрузка тестовых данных в Supabase.

Запуск из папки backend:
    python -m scripts.seed

Скрипт полностью пересоздаёт данные: удаляет заводы и модели авто (остальное удаляется каскадно)
и заливает заново. Генерация детерминирована (SEED), поэтому результат всегда одинаковый.

Что моделируется:
- завод СарыаркаАвтоПром, рабочие дни 01.07.2026–05.10.2026, 2 смены по 8 часов (тестовые данные кейса);
- поточная линия Сварка -> Окраска -> Сборка -> ОТК с межоперационными буферами:
  простой на участке выше по потоку «голодит» участки ниже, а переполненный буфер блокирует участок выше;
- Окраска — узкое место (больше простоев и брака, допустимый брак 2% превышается);
- деградация Конвейера-03 (рост микропростоев до обрыва цепи 02.10) и Камеры-02 (рост засоров и брака
  к концу периода) — материал для прогноза простоев;
- строки из файла с тестовыми данными (простои и план/факт/брак за 01–02.10) воспроизводятся точно.
"""

import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.core.database import get_supabase
from app.simulator.plant import (
    AREA_NAMES, AREAS, CAR_MODELS, CRIT_WEIGHT, EQUIPMENT, EQUIPMENT_BY_CODE, FACTORY, HOURLY_PLAN,
    INITIAL_BUFFER, LINE_AREAS, MATERIAL_SHORTAGE_REASONS, MAX_BUFFER, QUALITY_INCIDENT_THRESHOLD, REASONS,
    REWORK_RATE, SAFETY_INCIDENTS, SCRAP_RATE, SHIFT_MINUTES, TREND_REASONS, TZ, binomial, downtime_severity, poisson,
)

SEED = 3
START_DATE = date(2026, 7, 1)
END_DATE = date(2026, 10, 5)
NOW = datetime(2026, 10, 6, 9, 0, tzinfo=TZ)
HOLIDAYS = {date(2026, 7, 6), date(2026, 8, 31)}  # День столицы, перенос Дня Конституции

# Текущее состояние оборудования на момент NOW (остальное — running)
CURRENT_STATUS = {"WH-AGV-02": "breakdown", "WH-FL-02": "maintenance", "WLD-ABB-06": "idle"}

# Простои из тестовых данных: (дата, номер смены, оборудование, причина, тип, начало от старта смены, длительность)
DOC_DOWNTIME = [
    (date(2026, 10, 1), 1, "WLD-ABB-01", "Ошибка датчика", "breakdown", 135, 25),
    (date(2026, 10, 1), 2, "PNT-CAB-02", "Замена фильтра", "planned_maintenance", 0, 40),
    (date(2026, 10, 2), 1, "WLD-ABB-04", "Плановое ТО", "planned_maintenance", 0, 30),
    (date(2026, 10, 2), 2, "ASM-CNV-03", "Обрыв цепи", "breakdown", 200, 55),
]

# Работа линий и качество из тестовых данных (дневная смена): actual, runtime_h, load_%, scrap
DOC_PRODUCTION = {
    (date(2026, 10, 1), "WELD"): (118, 7.8, 98, 2),
    (date(2026, 10, 1), "PAINT"): (115, 7.5, 94, 4),
    (date(2026, 10, 1), "ASSY"): (121, 8.0, 100, 1),
    (date(2026, 10, 2), "WELD"): (111, 7.2, 91, 3),
    (date(2026, 10, 2), "PAINT"): (116, 7.7, 96, 6),
    (date(2026, 10, 2), "ASSY"): (119, 7.9, 99, 2),
}


@dataclass
class ShiftData:
    index: int
    day: date
    number: int
    start_at: datetime
    end_at: datetime
    models: list[str] = field(default_factory=list)  # модель на каждый час смены

    @property
    def name(self) -> str:
        return "Смена 1 (дневная)" if self.number == 1 else "Смена 2 (вечерняя)"


def progress(day: date, start: date, end: date) -> float:
    if day < start or day > end:
        return 0.0
    return (day - start).days / max((end - start).days, 1)


def trend_multiplier(code: str, day: date) -> float:
    if code == "ASM-CNV-03":
        p = progress(day, date(2026, 9, 14), date(2026, 10, 2))
        return 1 + 15 * p
    if code == "PNT-CAB-02":
        p = progress(day, date(2026, 9, 20), END_DATE)
        return 1 + 4 * p
    return 1.0


def fit_to_total(values: list[int], target: int, cap: int | None = None) -> list[int]:
    values = list(values)
    diff = target - sum(values)
    step = 1 if diff > 0 else -1
    i = 0
    while diff != 0 and i < 10_000:
        j = i % len(values)
        new = values[j] + step
        if new >= 0 and (cap is None or new <= cap):
            values[j] = new
            diff -= step
        i += 1
    return values


def iso(dt: datetime) -> str:
    return dt.isoformat()


def build_shifts() -> list[ShiftData]:
    shifts = []
    day = START_DATE
    while day <= END_DATE:
        if day.weekday() < 5 and day not in HOLIDAYS:
            for number, hour in ((1, 8), (2, 16)):
                start = datetime(day.year, day.month, day.day, hour, tzinfo=TZ)
                s = ShiftData(len(shifts), day, number, start, start + timedelta(minutes=SHIFT_MINUTES))
                last = "JAC-J7" if s.index % 2 == 0 else "CHEV-TRACKER"
                s.models = ["CHEV-ONIX"] * 4 + ["CHEV-COBALT"] * 3 + [last]
                shifts.append(s)
        day += timedelta(days=1)
    return shifts


def generate_downtime(rng: random.Random, shift: ShiftData) -> list[dict]:
    """Простои за смену. start/end — минуты от начала смены."""
    events = []
    forced = {(code): (r, t, s, d) for dd, n, code, r, t, s, d in DOC_DOWNTIME if dd == shift.day and n == shift.number}

    for code, (reason, type_, start, dur) in forced.items():
        events.append({"code": code, "reason": reason, "type": type_, "start": start, "end": start + dur})

    for area, code, _, _, kind, rate in EQUIPMENT:
        if code in forced:
            continue
        mult = trend_multiplier(code, shift.day)
        busy: list[tuple[int, int]] = []
        for _ in range(poisson(rng, rate * mult)):
            if code in TREND_REASONS and mult > 1 and rng.random() < 0.7:
                reason, type_, lo, hi = rng.choice(TREND_REASONS[code])
            else:
                options = REASONS[kind]
                reason, type_, lo, hi, _ = rng.choices(options, weights=[o[4] for o in options])[0]
            dur = rng.randint(lo, hi)
            for _attempt in range(5):
                if type_ == "planned_maintenance" and rng.random() < 0.6:
                    start = 0
                else:
                    start = rng.randint(0, SHIFT_MINUTES - dur)
                end = start + dur
                if all(end <= b0 or start >= b1 for b0, b1 in busy):
                    busy.append((start, end))
                    events.append({"code": code, "reason": reason, "type": type_, "start": start, "end": end})
                    break

    if rng.random() < 0.12:
        dur = rng.randint(15, 60)
        start = rng.randint(0, SHIFT_MINUTES - dur)
        events.append({
            "code": "ASM-CNV-02", "reason": rng.choice(MATERIAL_SHORTAGE_REASONS),
            "type": "material_shortage", "start": start, "end": start + dur,
        })
    return events


def line_stop_minutes(events: list[dict]) -> dict[str, list[float]]:
    """Доля остановки линии на каждой минуте смены по участкам (с учётом критичности оборудования)."""
    stops = {area: [0.0] * SHIFT_MINUTES for area in LINE_AREAS}
    for e in events:
        area, _, _, crit, _, _ = EQUIPMENT_BY_CODE[e["code"]]
        if area not in stops:
            continue
        weight = 1.0 if e["type"] == "material_shortage" else CRIT_WEIGHT[crit]
        minutes = stops[area]
        for m in range(e["start"], min(e["end"], SHIFT_MINUTES)):
            minutes[m] = max(minutes[m], weight)
    return stops


def generate() -> dict:
    rng = random.Random(SEED)
    shifts = build_shifts()
    buffers = {area: INITIAL_BUFFER for area in LINE_AREAS[1:]}

    downtime, production, quality, plans, incidents = [], [], [], [], []

    for shift in shifts:
        events = generate_downtime(rng, shift)
        stops = line_stop_minutes(events)
        cab02_trend = progress(shift.day, date(2026, 9, 20), END_DATE)
        evening_penalty = 0.012 if shift.number == 2 else 0.0

        for model in set(shift.models):
            plans.append({"shift": shift.index, "model": model,
                          "planned_quantity": HOURLY_PLAN * shift.models.count(model)})

        shift_prod = defaultdict(list)  # area -> [(production_row, quality_row)]
        for hour, model in enumerate(shift.models):
            ts = shift.start_at + timedelta(hours=hour)
            for idx, area in enumerate(LINE_AREAS):
                lost = sum(stops[area][hour * 60:(hour + 1) * 60])
                available = 60 - lost
                perf = min(max(rng.gauss(0.99 - evening_penalty, 0.03), 0.85), 1.08)
                capacity = round(HOURLY_PLAN * available / 60 * perf)
                supply = buffers[area] if area in buffers else 10**6
                next_area = LINE_AREAS[idx + 1] if idx + 1 < len(LINE_AREAS) else None
                space = MAX_BUFFER - buffers[next_area] if next_area else 10**6
                actual = max(0, min(capacity, supply, space))

                if actual >= capacity:
                    runtime = round(available)
                else:
                    runtime = min(round(available), round(actual * 60 / (HOURLY_PLAN * perf)))

                scrap_p = SCRAP_RATE[area] + (0.025 * cab02_trend if area == "PAINT" else 0)
                rework_p = REWORK_RATE[area] + (0.02 * cab02_trend if area == "PAINT" else 0)
                scrap = binomial(rng, actual, scrap_p)
                rework = binomial(rng, actual - scrap, rework_p)

                if area in buffers:
                    buffers[area] -= actual
                if next_area:
                    buffers[next_area] += actual - scrap

                prod = {"shift": shift.index, "area": area, "model": model, "timestamp": ts,
                        "planned_quantity": HOURLY_PLAN, "actual_quantity": actual,
                        "runtime_minutes": runtime, "load_percent": round(runtime / 60 * 100, 2)}
                qual = {"shift": shift.index, "area": area, "model": model, "timestamp": ts,
                        "total_quantity": actual, "scrap_quantity": scrap, "rework_quantity": rework}
                shift_prod[area].append((prod, qual))

        apply_doc_overrides(shift, shift_prod)

        for area, rows in shift_prod.items():
            for prod, qual in rows:
                qual["good_quantity"] = qual["total_quantity"] - qual["scrap_quantity"] - qual["rework_quantity"]
                production.append(prod)
                quality.append(qual)

        for e in events:
            downtime.append({
                "shift": shift.index, "code": e["code"], "reason": e["reason"], "type": e["type"],
                "started_at": shift.start_at + timedelta(minutes=e["start"]),
                "ended_at": shift.start_at + timedelta(minutes=e["end"]),
            })

        incidents.extend(shift_incidents(rng, shift, events, shift_prod))

    # Текущий незакрытый простой: AGV-02 стоит с вечера 05.10
    last = shifts[-1]
    agv_start = last.start_at + timedelta(minutes=400)
    downtime.append({"shift": last.index, "code": "WH-AGV-02", "reason": "Отказ лидара навигации",
                     "type": "breakdown", "started_at": agv_start, "ended_at": None})
    incidents.append({
        "area": "WH-IN", "code": "WH-AGV-02", "shift": last.index, "created_at": agv_start + timedelta(minutes=3),
        "severity": "medium", "type": "equipment_failure", "status": "open",
        "title": "Отказ: Транспортная тележка AGV-02 — Отказ лидара навигации",
        "description": "AGV-02 остановлена, ожидается замена лидара. Доставка комплектующих выполняется погрузчиками.",
    })

    incidents.extend(daily_downtime_limit_incidents(downtime, shifts))
    for inc in incidents:
        inc.setdefault("status", incident_status(rng, inc["created_at"]))

    return {"shifts": shifts, "downtime": downtime, "production": production,
            "quality": quality, "plans": plans, "incidents": incidents}


def apply_doc_overrides(shift: ShiftData, shift_prod: dict) -> None:
    if shift.number != 1:
        return
    for area, rows in shift_prod.items():
        doc = DOC_PRODUCTION.get((shift.day, area))
        if not doc:
            continue
        actual_total, runtime_h, load, scrap_total = doc
        prods = [p for p, _ in rows]
        quals = [q for _, q in rows]

        actuals = fit_to_total([p["actual_quantity"] for p in prods], actual_total)
        runtimes = fit_to_total([p["runtime_minutes"] for p in prods], round(runtime_h * 60), cap=60)
        load_factor = load / (runtime_h / 8 * 100)
        for p, q, a, r in zip(prods, quals, actuals, runtimes):
            p["actual_quantity"] = a
            p["runtime_minutes"] = r
            p["load_percent"] = round(min(100.0, r / 60 * 100 * load_factor), 2)
            q["total_quantity"] = a

        scraps = [0] * len(quals)
        for i in range(scrap_total):  # равномерно по часам смены
            scraps[(i * 3) % len(scraps)] += 1
        for q, s in zip(quals, scraps):
            q["scrap_quantity"] = min(s, q["total_quantity"])
            q["rework_quantity"] = min(q["rework_quantity"], q["total_quantity"] - q["scrap_quantity"])


def shift_incidents(rng: random.Random, shift: ShiftData, events: list[dict], shift_prod: dict) -> list[dict]:
    result = []
    shift_label = f"{shift.name}, {shift.day:%d.%m.%Y}"

    for e in events:
        area, code, name, crit, _, _ = EQUIPMENT_BY_CODE[e["code"]]
        duration = e["end"] - e["start"]
        created = shift.start_at + timedelta(minutes=e["start"] + rng.randint(1, 5))
        if e["type"] == "breakdown" and duration >= 25:
            result.append({
                "area": area, "code": code, "shift": shift.index, "created_at": created,
                "severity": downtime_severity(crit, duration), "type": "equipment_failure",
                "title": f"Отказ: {name} — {e['reason']}",
                "description": f"Простой {duration} мин. Участок «{AREA_NAMES[area]}», {shift_label}.",
            })
        elif e["type"] == "material_shortage" and duration >= 20:
            result.append({
                "area": area, "code": code, "shift": shift.index, "created_at": created,
                "severity": "high" if duration >= 45 else "medium", "type": "material_shortage",
                "title": e["reason"],
                "description": f"Сборочная линия остановлена на {duration} мин из-за отсутствия комплектующих. {shift_label}.",
            })

    for area, rows in shift_prod.items():
        total = sum(q["total_quantity"] for _, q in rows)
        scrap = sum(q["scrap_quantity"] for _, q in rows)
        rate = scrap / total if total else 0
        threshold = QUALITY_INCIDENT_THRESHOLD[area]
        if rate > threshold:
            result.append({
                "area": area, "code": None, "shift": shift.index,
                "created_at": shift.end_at - timedelta(minutes=rng.randint(5, 30)),
                "severity": "high" if rate > threshold * 1.5 else "medium", "type": "quality_deviation",
                "title": f"Превышение уровня брака на участке «{AREA_NAMES[area]}»: {rate:.1%}",
                "description": f"Брак {scrap} из {total} ед. (порог инцидента {threshold:.0%}, допустимый уровень 2%). {shift_label}.",
            })

    planned = HOURLY_PLAN * len(shift.models)
    output = sum(q["total_quantity"] - q["scrap_quantity"] for _, q in shift_prod["QC"])
    if output < planned * 0.85:
        bottleneck = min(LINE_AREAS, key=lambda a: sum(p["actual_quantity"] for p, _ in shift_prod[a]))
        result.append({
            "area": bottleneck, "code": None, "shift": shift.index, "created_at": shift.end_at,
            "severity": "high" if output < planned * 0.75 else "medium", "type": "plan_deviation",
            "title": f"Невыполнение сменного плана: {output} из {planned}",
            "description": f"Выполнение {output / planned:.0%}. Узкое место смены — участок «{AREA_NAMES[bottleneck]}». {shift_label}.",
        })

    if rng.random() < 0.035:
        title, description = rng.choice(SAFETY_INCIDENTS)
        area = rng.choice(["WH-IN", "WELD", "PAINT", "ASSY", "QC", "WH-OUT"])
        result.append({
            "area": area, "code": None, "shift": shift.index,
            "created_at": shift.start_at + timedelta(minutes=rng.randint(30, 450)),
            "severity": rng.choice(["low", "medium"]), "type": "safety",
            "title": title, "description": f"{description} Участок «{AREA_NAMES[area]}», {shift_label}.",
        })
    return result


def daily_downtime_limit_incidents(downtime: list[dict], shifts: list[ShiftData]) -> list[dict]:
    """Правило из кейса: простой критичного оборудования не более 60 мин в сутки."""
    per_day = defaultdict(lambda: defaultdict(int))
    last_shift_of_day = {}
    for s in shifts:
        last_shift_of_day[s.day] = s
    for d in downtime:
        if d["ended_at"] is None or EQUIPMENT_BY_CODE[d["code"]][3] != "high":
            continue
        minutes = int((d["ended_at"] - d["started_at"]).total_seconds() // 60)
        per_day[d["started_at"].date()][EQUIPMENT_BY_CODE[d["code"]][0]] += minutes

    result = []
    for day, by_area in sorted(per_day.items()):
        total = sum(by_area.values())
        if total <= 60:
            continue
        area = max(by_area, key=by_area.get)
        shift = last_shift_of_day[day]
        result.append({
            "area": area, "code": None, "shift": shift.index, "created_at": shift.end_at,
            "severity": "critical" if total >= 120 else "high", "type": "downtime_limit",
            "title": f"Превышен лимит простоя критичного оборудования: {total} мин за сутки",
            "description": f"Лимит — 60 мин/сутки. Основной вклад — участок «{AREA_NAMES[area]}» ({by_area[area]} мин). {day:%d.%m.%Y}.",
        })
    return result


def incident_status(rng: random.Random, created_at: datetime) -> str:
    age = NOW - created_at
    if age > timedelta(days=7):
        return rng.choices(["closed", "resolved"], weights=[85, 15])[0]
    if age > timedelta(days=2):
        return rng.choices(["resolved", "closed", "in_progress", "open"], weights=[40, 20, 30, 10])[0]
    return rng.choice(["open", "in_progress"])


# ---------------------------------------------------------------- загрузка в Supabase

def insert(db, table: str, rows: list[dict], chunk: int = 1000) -> list[dict]:
    result = []
    for i in range(0, len(rows), chunk):
        result.extend(db.table(table).insert(rows[i:i + chunk]).execute().data)
    print(f"  {table}: {len(rows)}")
    return result


def main() -> None:
    data = generate()
    db = get_supabase()

    print("Очистка старых данных...")
    db.table("factories").delete().gte("id", 0).execute()
    db.table("car_models").delete().gte("id", 0).execute()

    print("Загрузка:")
    factory_id = insert(db, "factories", [FACTORY])[0]["id"]
    model_ids = {r["code"]: r["id"] for r in insert(db, "car_models", [{"name": n, "code": c} for n, c in CAR_MODELS])}
    area_ids = {r["code"]: r["id"] for r in insert(db, "production_areas", [
        {"factory_id": factory_id, "code": c, "name": n, "sequence": s} for c, n, s in AREAS])}
    equipment_ids = {r["code"]: r["id"] for r in insert(db, "equipment", [
        {"production_area_id": area_ids[a], "code": c, "name": n, "criticality": crit,
         "status": CURRENT_STATUS.get(c, "running")} for a, c, n, crit, _, _ in EQUIPMENT])}

    shifts = data["shifts"]
    inserted = insert(db, "shifts", [{"factory_id": factory_id, "name": s.name,
                                      "start_at": iso(s.start_at), "end_at": iso(s.end_at)} for s in shifts])
    id_by_start = {datetime.fromisoformat(r["start_at"]): r["id"] for r in inserted}
    shift_ids = [id_by_start[s.start_at] for s in shifts]

    insert(db, "production_plans", [
        {"factory_id": factory_id, "shift_id": shift_ids[p["shift"]], "car_model_id": model_ids[p["model"]],
         "planned_quantity": p["planned_quantity"]} for p in data["plans"]])

    def with_refs(row: dict) -> dict:
        out = {k: v for k, v in row.items() if k not in ("shift", "area", "model")}
        out.update(shift_id=shift_ids[row["shift"]], production_area_id=area_ids[row["area"]],
                   car_model_id=model_ids[row["model"]], timestamp=iso(row["timestamp"]))
        return out

    insert(db, "production_records", [with_refs(r) for r in data["production"]])
    insert(db, "quality_records", [with_refs(r) for r in data["quality"]])

    insert(db, "downtime_events", [
        {"equipment_id": equipment_ids[d["code"]], "shift_id": shift_ids[d["shift"]],
         "started_at": iso(d["started_at"]), "ended_at": iso(d["ended_at"]) if d["ended_at"] else None,
         "reason": d["reason"], "type": d["type"]} for d in data["downtime"]])

    insert(db, "incidents", [
        {"production_area_id": area_ids[i["area"]],
         "equipment_id": equipment_ids[i["code"]] if i["code"] else None,
         "shift_id": shift_ids[i["shift"]], "created_at": iso(i["created_at"]),
         "severity": i["severity"], "type": i["type"], "title": i["title"],
         "description": i["description"], "status": i["status"]}
        for i in sorted(data["incidents"], key=lambda x: x["created_at"])])

    print("Готово.")


if __name__ == "__main__":
    main()
