"""
Прогноз последствий вариантов решения инцидента.

Для каждого действия (и для «ничего не менять») копия состояния завода прогоняется тем же движком на
HORIZON минут вперёд, в памяти, без записи в БД. Прогонов несколько, с одинаковыми наборами случайных
событий для всех вариантов (common random numbers): так разница между вариантами — эффект самого решения,
а не везения. Цифры в таблице вариантов берутся отсюда, а не придумываются языковой моделью.
"""
import asyncio
import copy
import random

from app.simulator import plant as P
from app.simulator.engine import ACTIONS, PlantSimulator

HORIZON = 180  # мин завода
RUNS = 6

# Экономика — те же допущения, что на дашборде (front/src/lib/model.js, ECON)
CAR_MARGIN_KZT = 350_000
DEFECT_KZT = 120_000

# Строки таблицы вариантов. better — какое направление лучше (для подсветки на фронте)
METRICS = [
    {"key": "output", "label": "Выпуск линии за 3 ч", "unit": "авто", "better": "higher", "digits": 0},
    {"key": "area_downtime", "label": "Простой участка", "unit": "мин", "better": "lower", "digits": 0},
    {"key": "scrap_pct", "label": "Брак участка", "unit": "%", "better": "lower", "digits": 1},
    {"key": "oee", "label": "OEE участка", "unit": "%", "better": "higher", "digits": 1},
    {"key": "cost", "label": "Затраты на меры", "unit": "тыс. ₸", "better": "lower", "digits": 0},
    {"key": "effect", "label": "Эффект к «ничего не менять»", "unit": "тыс. ₸", "better": "higher", "digits": 0},
]


class MemoryStore:
    """Хранилище-заглушка: прогноз ничего не пишет в БД."""

    def __init__(self):
        self.inserts = 0
        self.counts: dict[str, int] = {}  # сколько строк «вставлено» по таблицам (например, инцидентов)
        self._seq = 10 ** 12

    async def insert(self, table: str, row: dict) -> dict:
        self.counts[table] = self.counts.get(table, 0) + 1
        self._seq += 1
        return {"id": self._seq, **row}

    async def insert_many(self, table: str, rows: list[dict]) -> list[dict]:
        return [await self.insert(table, r) for r in rows]

    async def update(self, table: str, row_id: int, fields: dict) -> dict:
        return {"id": row_id, **fields}


class NullHub:
    def publish(self, message: dict) -> None:
        pass

    def upsert(self, table: str, *rows: dict) -> None:
        pass

    def notice(self, *args, **kwargs) -> None:
        pass


async def _run(snapshot: dict, refs: dict, inc_id: int, action: str, seed: int) -> dict:
    sim = PlantSimulator(MemoryStore(), NullHub(), random.Random(seed))
    sim.refs = refs
    sim.codes = [c for c in refs["equipment"] if c in P.EQUIPMENT_BY_CODE]
    sim.code_by_id = {e["id"]: c for c, e in refs["equipment"].items()}
    sim.st = copy.deepcopy(snapshot)
    sim.decisions_enabled = False
    if action != "none":
        await sim.apply_action(action, inc_id, sim.now)
    # Решение по исходному инциденту в копии уже не нужно — иначе движок применит «ничего» по таймеру
    sim.st["decisions"].clear()
    for _ in range(HORIZON):
        await sim.step()
    return dict(sim.stats)


def _metrics(stats: dict, area: str, action: str) -> dict:
    minutes = stats.get(f"minutes:{area}", 0) or 1
    made = stats.get(f"made:{area}", 0)
    scrap = stats.get(f"scrap:{area}", 0)
    runtime = stats.get(f"runtime:{area}", 0)
    return {
        "output": stats.get("line_out", 0),
        "area_downtime": max(0.0, minutes - runtime),
        "scrap_pct": scrap / made * 100 if made else 0.0,
        "scrap": scrap,
        "oee": min(100.0, (made - scrap) / (P.HOURLY_PLAN / 60 * minutes) * 100),
        "cost": (ACTIONS[action]["cost"] if action != "none" else 0) / 1000,
    }


async def _forecast(snapshot: dict, refs: dict, inc_id: int, area: str, actions: list[str]) -> dict[str, dict]:
    seeds = [random.randrange(10 ** 9) for _ in range(RUNS)]
    result = {}
    for action in actions:
        runs = [_metrics(await _run(snapshot, refs, inc_id, action, seed), area, action) for seed in seeds]
        result[action] = {k: sum(r[k] for r in runs) / len(runs) for k in runs[0]}
    base = result["none"]
    for action, m in result.items():
        m["effect"] = ((m["output"] - base["output"]) * CAR_MARGIN_KZT
                       + (base["scrap"] - m["scrap"]) * DEFECT_KZT) / 1000 - m["cost"]
    return result


def forecast(snapshot: dict, refs: dict, inc_id: int, area: str, actions: list[str]) -> dict[str, dict]:
    """Синхронная обёртка: вызывается через asyncio.to_thread, чтобы не тормозить живую симуляцию."""
    return asyncio.run(_forecast(snapshot, refs, inc_id, area, ["none", *[a for a in actions if a != "none"]]))


def round_metrics(values: dict) -> dict:
    return {m["key"]: round(values[m["key"]], m["digits"]) if m["digits"] else round(values[m["key"]])
            for m in METRICS}
