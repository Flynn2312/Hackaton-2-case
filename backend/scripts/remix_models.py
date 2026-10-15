"""
Перераспределяет накопленную историю по расширенному модельному ряду (plant.CAR_MODELS) без пересоздания данных.

Запуск из папки backend:
    python -m scripts.remix_models           # только показать, что изменится
    python -m scripts.remix_models --apply   # записать в БД

Что делает:
- добавляет недостающие модели в car_models;
- для каждой завершённой смены заново раскладывает модели по часам (plant.shift_models — очередь партий
  по дню и номеру смены) и переписывает car_model_id почасовых записей выработки и качества;
- в часы, где модель сменилась, брак масштабируется отношением множителей plant.MODEL_QUALITY, годные пересчитываются;
- пересобирает план смены по моделям (production_plans) по тем часам, что есть в записях.

Объёмы выпуска, простои и инциденты не меняются. Идущая смена не трогается — её пишет симулятор.
Повторный запуск ничего не меняет: раскладка по дню и номеру смены всегда одна и та же.
"""

import asyncio
import random
import sys
from collections import Counter, defaultdict
from datetime import timedelta

import asyncpg

from app.core.config import get_settings
from app.simulator.plant import CAR_MODELS, HOURLY_PLAN, MODEL_QUALITY, TZ, shift_models


def round_random(rng: random.Random, v: float) -> int:
    base = int(v)
    return base + (1 if rng.random() < v - base else 0)


async def main(apply: bool) -> None:
    conn = await asyncpg.connect(get_settings().database_url, statement_cache_size=0)
    try:
        if apply:
            await conn.executemany(
                "INSERT INTO public.car_models (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", CAR_MODELS)
        model_ids = {r["code"]: r["id"] for r in await conn.fetch("SELECT id, code FROM public.car_models")}
        # В пробном прогоне недостающих моделей ещё нет в БД — временные отрицательные id только для отчёта
        for i, (_, code) in enumerate(CAR_MODELS):
            model_ids.setdefault(code, -1 - i)
        code_of = {v: k for k, v in model_ids.items()}

        sim_now = await conn.fetchval("SELECT sim_now FROM public.simulator_state WHERE id = 1")
        shifts = await conn.fetch("SELECT id, factory_id, start_at, end_at FROM public.shifts ORDER BY start_at")
        latest = shifts[-1]["id"] if shifts else None
        done = [s for s in shifts if s["id"] != latest and (sim_now is None or s["end_at"] <= sim_now)]
        ids = [s["id"] for s in done]

        prod = await conn.fetch(
            "SELECT id, shift_id, timestamp, car_model_id FROM public.production_records WHERE shift_id = ANY($1)", ids)
        qual = await conn.fetch(
            "SELECT id, shift_id, timestamp, car_model_id, total_quantity, scrap_quantity, rework_quantity "
            "FROM public.quality_records WHERE shift_id = ANY($1)", ids)

        # Новая раскладка: модель на каждый час смены
        start = {s["id"]: s["start_at"] for s in done}
        # Номер смены — по времени начала: дневная с 08:00, вечерняя с 16:00
        plan_for = {s["id"]: shift_models(s["start_at"].astimezone(TZ).date(), 1 if s["start_at"].astimezone(TZ).hour < 12 else 2,
                                          model_ids) for s in done}

        def model_at(row) -> int:
            hour = int((row["timestamp"] - start[row["shift_id"]]) / timedelta(hours=1))
            models = plan_for[row["shift_id"]]
            return model_ids[models[min(max(hour, 0), len(models) - 1)]]

        prod_upd = [(r["id"], model_at(r)) for r in prod if model_at(r) != r["car_model_id"]]
        qual_upd = []
        for r in qual:
            new = model_at(r)
            if new == r["car_model_id"]:
                continue
            rng = random.Random(r["id"])
            k = MODEL_QUALITY.get(code_of[new], 1.0) / MODEL_QUALITY.get(code_of.get(r["car_model_id"]), 1.0)
            total, rework = r["total_quantity"], r["rework_quantity"]
            scrap = min(round_random(rng, r["scrap_quantity"] * k), max(0, total - rework))
            qual_upd.append((r["id"], new, scrap, total - scrap - rework))

        # План смены по моделям — по часам, для которых есть записи
        hours = defaultdict(set)
        for r in prod:
            hours[r["shift_id"]].add(r["timestamp"])
        factory = {s["id"]: s["factory_id"] for s in done}
        plans = []
        for sid, stamps in hours.items():
            per_model = Counter(model_at({"shift_id": sid, "timestamp": t}) for t in stamps)
            plans += [(factory[sid], sid, m, HOURLY_PLAN * n) for m, n in per_model.items()]

        # Отчёт: доля выпуска по моделям после раскладки (часы × план часа)
        mix = Counter()
        for sid, stamps in hours.items():
            for t in stamps:
                mix[code_of[model_at({"shift_id": sid, "timestamp": t})]] += HOURLY_PLAN
        print(f"Смен к раскладке: {len(done)} (идущая смена {latest} не трогается)")
        print(f"Записей выработки к изменению: {len(prod_upd)}, качества: {len(qual_upd)}, строк плана: {len(plans)}")
        total = sum(mix.values()) or 1
        for code, n in mix.most_common():
            print(f"  {code:16} {n:7} авто по плану  {n / total:6.1%}")

        if not apply:
            print("\nПробный прогон. Запишите в БД: python -m scripts.remix_models --apply")
            return

        async with conn.transaction():
            await conn.execute("""
                UPDATE public.production_records p SET car_model_id = v.m
                FROM unnest($1::bigint[], $2::bigint[]) AS v(id, m) WHERE p.id = v.id""",
                [u[0] for u in prod_upd], [u[1] for u in prod_upd])
            await conn.execute("""
                UPDATE public.quality_records q SET car_model_id = v.m, scrap_quantity = v.s, good_quantity = v.g
                FROM unnest($1::bigint[], $2::bigint[], $3::int[], $4::int[]) AS v(id, m, s, g) WHERE q.id = v.id""",
                [u[0] for u in qual_upd], [u[1] for u in qual_upd], [u[2] for u in qual_upd], [u[3] for u in qual_upd])
            await conn.execute("DELETE FROM public.production_plans WHERE shift_id = ANY($1)", list(hours))
            await conn.execute("""
                INSERT INTO public.production_plans (factory_id, shift_id, car_model_id, planned_quantity)
                SELECT * FROM unnest($1::bigint[], $2::bigint[], $3::bigint[], $4::int[])""",
                [p[0] for p in plans], [p[1] for p in plans], [p[2] for p in plans], [p[3] for p in plans])
        print("\nГотово: история перераспределена. Обновите дашборд.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
