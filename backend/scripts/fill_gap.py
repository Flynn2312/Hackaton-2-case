"""
Дозаполняет пропуски в истории завода: рабочие дни без смен между началом истории и стартом симулятора.
Пропуск появляется после сброса симулятора: генерация начинается с текущей даты, а дни между концом сида
и сбросом остаются пустыми.

Запуск из папки backend:
    python -m scripts.fill_gap           # только показать, что будет добавлено
    python -m scripts.fill_gap --apply   # записать в БД

Данные генерируются той же моделью, что и сид (scripts/seed.generate): смены, план по моделям, почасовая
выработка и качество, простои, инциденты. Заодно чинит неправдоподобные простои длиннее смены — след бага,
когда открытый простой закрывался от момента старта симулятора, а не от своего начала.
Повторный запуск ничего не добавляет: заполненные дни уже не считаются пропуском.
"""

import asyncio
import random
import sys
from datetime import date, datetime, timedelta
from decimal import Decimal

import asyncpg

from app.core.config import get_settings
from app.simulator.plant import SHIFT_MINUTES, TZ
from scripts.seed import HOLIDAYS, SEED, generate


def working(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def gap_ranges(have: set[date], first: date, until: date) -> list[tuple[date, date]]:
    """Непрерывные отрезки рабочих дней без смен в [first, until)."""
    ranges, cur = [], None
    day = first
    while day < until:
        if working(day):
            if day in have:
                if cur:
                    ranges.append(cur)
                cur = None
            else:
                cur = (cur[0], day) if cur else (day, day)
        day += timedelta(days=1)
    if cur:
        ranges.append(cur)
    return ranges


async def main(apply: bool) -> None:
    conn = await asyncpg.connect(get_settings().database_url, statement_cache_size=0)
    try:
        factory_id = await conn.fetchval("SELECT id FROM public.factories ORDER BY id LIMIT 1")
        area_ids = {r["code"]: r["id"] for r in await conn.fetch(
            "SELECT id, code FROM public.production_areas WHERE factory_id = $1", factory_id)}
        equipment_ids = {r["code"]: r["id"] for r in await conn.fetch("SELECT id, code FROM public.equipment")}
        model_ids = {r["code"]: r["id"] for r in await conn.fetch("SELECT id, code FROM public.car_models")}
        starts = [r["start_at"] for r in await conn.fetch("SELECT start_at FROM public.shifts WHERE factory_id = $1", factory_id)]
        sim_started = await conn.fetchval("SELECT started_at FROM public.simulator_state WHERE id = 1")

        have = {s.astimezone(TZ).date() for s in starts}
        # Пропуском считаем только прошлое: дни до старта генерации симулятора
        until = sim_started.astimezone(TZ).date() if sim_started else max(have) + timedelta(days=1)
        ranges = gap_ranges(have, min(have), until)
        now = sim_started.astimezone(TZ) if sim_started else datetime.now(TZ)

        batches = []
        for a, b in ranges:
            data = generate(a, b, now=now, seed=SEED * 100_000 + a.toordinal(), open_tail=False)
            batches.append(((a, b), data))
            print(f"Пропуск {a:%d.%m}–{b:%d.%m}: смен {len(data['shifts'])}, выработка {len(data['production'])} записей, "
                  f"простоев {len(data['downtime'])}, инцидентов {len(data['incidents'])}")
        if not ranges:
            print("Пропусков в истории нет.")

        long_dt = await conn.fetch(f"""
            SELECT d.id, e.code, d.reason, d.started_at, d.duration_minutes FROM public.downtime_events d
            JOIN public.equipment e ON e.id = d.equipment_id WHERE d.duration_minutes > {SHIFT_MINUTES}""")
        for r in long_dt:
            print(f"Простой {r['id']} {r['code']} «{r['reason']}» — {r['duration_minutes']} мин: будет укорочен")

        if not apply:
            print("\nПробный прогон. Запишите в БД: python -m scripts.fill_gap --apply")
            return

        async with conn.transaction():
            for _, data in batches:
                shift_ids = []
                for s in data["shifts"]:
                    shift_ids.append(await conn.fetchval(
                        "INSERT INTO public.shifts (factory_id, name, start_at, end_at) VALUES ($1, $2, $3, $4) RETURNING id",
                        factory_id, s.name, s.start_at, s.end_at))
                await conn.executemany(
                    "INSERT INTO public.production_plans (factory_id, shift_id, car_model_id, planned_quantity) VALUES ($1, $2, $3, $4)",
                    [(factory_id, shift_ids[p["shift"]], model_ids[p["model"]], p["planned_quantity"]) for p in data["plans"]])
                await conn.executemany("""
                    INSERT INTO public.production_records (shift_id, production_area_id, car_model_id, timestamp,
                        planned_quantity, actual_quantity, runtime_minutes, load_percent)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                    [(shift_ids[r["shift"]], area_ids[r["area"]], model_ids[r["model"]], r["timestamp"],
                      r["planned_quantity"], r["actual_quantity"], r["runtime_minutes"], Decimal(str(r["load_percent"])))
                     for r in data["production"]])
                await conn.executemany("""
                    INSERT INTO public.quality_records (shift_id, production_area_id, car_model_id, timestamp,
                        total_quantity, good_quantity, scrap_quantity, rework_quantity)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
                    [(shift_ids[r["shift"]], area_ids[r["area"]], model_ids[r["model"]], r["timestamp"],
                      r["total_quantity"], r["good_quantity"], r["scrap_quantity"], r["rework_quantity"])
                     for r in data["quality"]])
                await conn.executemany("""
                    INSERT INTO public.downtime_events (equipment_id, shift_id, started_at, ended_at, reason, type)
                    VALUES ($1, $2, $3, $4, $5, $6)""",
                    [(equipment_ids[d["code"]], shift_ids[d["shift"]], d["started_at"], d["ended_at"], d["reason"], d["type"])
                     for d in data["downtime"]])
                await conn.executemany("""
                    INSERT INTO public.incidents (production_area_id, equipment_id, shift_id, created_at, severity, type,
                        title, description, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    [(area_ids[i["area"]], equipment_ids[i["code"]] if i["code"] else None, shift_ids[i["shift"]],
                      i["created_at"], i["severity"], i["type"], i["title"], i["description"], i["status"])
                     for i in sorted(data["incidents"], key=lambda x: x["created_at"])])
            rng = random.Random(SEED)
            for r in long_dt:
                await conn.execute("UPDATE public.downtime_events SET ended_at = started_at + $2 WHERE id = $1",
                                   r["id"], timedelta(minutes=rng.randint(25, 55)))
        print("\nГотово: пропуски заполнены. Обновите дашборд.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
