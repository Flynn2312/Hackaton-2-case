"""Доступ симулятора к БД: справочники, запись событий, аренда генератора и сохранение состояния."""
import json
from datetime import datetime
from typing import Any

from asyncpg.pool import Pool

LEASE_SECONDS = 20  # владелец, молчащий дольше, теряет право генерировать


class SimStore:
    def __init__(self, pool: Pool):
        self.pool = pool
        self.inserts = 0  # счётчик вставок: после них состояние движка сохраняется сразу

    # ---------------------------------------------------------------- справочники

    async def load_refs(self) -> dict[str, Any]:
        factory = await self.pool.fetchrow("SELECT id FROM public.factories ORDER BY id LIMIT 1")
        if not factory:
            raise RuntimeError("В БД нет завода — сначала выполните python -m scripts.seed")
        areas = await self.pool.fetch(
            "SELECT id, code FROM public.production_areas WHERE factory_id = $1", factory["id"])
        equipment = await self.pool.fetch("""
            SELECT e.id, e.code, e.name, e.status, e.criticality, a.code AS area
            FROM public.equipment e JOIN public.production_areas a ON a.id = e.production_area_id
            WHERE a.factory_id = $1 ORDER BY e.id""", factory["id"])
        models = await self.pool.fetch("SELECT id, code FROM public.car_models")
        return {
            "factory_id": factory["id"],
            "area_ids": {r["code"]: r["id"] for r in areas},
            "equipment": {r["code"]: dict(r) for r in equipment},
            "model_ids": {r["code"]: r["id"] for r in models},
        }

    async def latest_shift_end(self, factory_id: int) -> datetime | None:
        return await self.pool.fetchval("SELECT max(end_at) FROM public.shifts WHERE factory_id = $1", factory_id)

    async def active_downtime(self) -> list[dict]:
        rows = await self.pool.fetch("SELECT * FROM public.downtime_events WHERE ended_at IS NULL")
        return [dict(r) for r in rows]

    async def open_incidents(self) -> list[dict]:
        rows = await self.pool.fetch(
            "SELECT id, equipment_id, status, created_at FROM public.incidents WHERE status IN ('open', 'in_progress')")
        return [dict(r) for r in rows]

    async def shift_exists(self, shift_id: int) -> bool:
        return bool(await self.pool.fetchval("SELECT 1 FROM public.shifts WHERE id = $1", shift_id))

    # ---------------------------------------------------------------- запись

    async def insert(self, table: str, row: dict) -> dict:
        cols = list(row)
        sql = (f"INSERT INTO public.{table} ({', '.join(cols)}) "
               f"VALUES ({', '.join(f'${i + 1}' for i in range(len(cols)))}) RETURNING *")
        self.inserts += 1
        return dict(await self.pool.fetchrow(sql, *row.values()))

    async def insert_many(self, table: str, rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        cols = list(rows[0])
        values, args = [], []
        for row in rows:
            values.append("(" + ", ".join(f"${len(args) + i + 1}" for i in range(len(cols))) + ")")
            args.extend(row[c] for c in cols)
        sql = f"INSERT INTO public.{table} ({', '.join(cols)}) VALUES {', '.join(values)} RETURNING *"
        self.inserts += 1
        return [dict(r) for r in await self.pool.fetch(sql, *args)]

    async def update(self, table: str, row_id: int, fields: dict) -> dict | None:
        cols = list(fields)
        sets = ", ".join(f"{c} = ${i + 2}" for i, c in enumerate(cols))
        row = await self.pool.fetchrow(
            f"UPDATE public.{table} SET {sets} WHERE id = $1 RETURNING *", row_id, *fields.values())
        return dict(row) if row else None

    # ---------------------------------------------------------------- аренда и состояние

    async def acquire_lease(self, owner: str) -> dict | None:
        """Забирает право генерировать, если оно свободно, просрочено или уже наше."""
        await self.pool.execute("INSERT INTO public.simulator_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING")
        row = await self.pool.fetchrow(f"""
            UPDATE public.simulator_state SET owner = $1, heartbeat_at = now()
            WHERE id = 1 AND (owner IS NULL OR owner = $1 OR heartbeat_at IS NULL
                              OR heartbeat_at < now() - interval '{LEASE_SECONDS} seconds')
            RETURNING *""", owner)
        return self._state_row(row)

    async def release_lease(self, owner: str) -> None:
        await self.pool.execute(
            "UPDATE public.simulator_state SET owner = NULL, heartbeat_at = NULL WHERE id = 1 AND owner = $1", owner)

    async def read_state(self) -> dict | None:
        return self._state_row(await self.pool.fetchrow("SELECT * FROM public.simulator_state WHERE id = 1"))

    async def save(self, owner: str, meta: dict, state: dict, prod: list[dict], qual: list[dict]) -> bool:
        """
        Одним запросом (один round-trip до Supabase): обновляет текущие почасовые записи выработки и качества,
        продлевает аренду и сохраняет состояние движка. False — аренду перехватил другой инстанс.
        """
        row = await self.pool.fetchrow("""
            WITH p AS (
                UPDATE public.production_records r
                SET planned_quantity = v.planned, actual_quantity = v.actual,
                    runtime_minutes = v.runtime, load_percent = v.load
                FROM unnest($1::bigint[], $2::int[], $3::int[], $4::int[], $5::numeric[])
                     AS v(id, planned, actual, runtime, load)
                WHERE r.id = v.id RETURNING r.id
            ), q AS (
                UPDATE public.quality_records r
                SET total_quantity = v.total, good_quantity = v.good,
                    scrap_quantity = v.scrap, rework_quantity = v.rework
                FROM unnest($6::bigint[], $7::int[], $8::int[], $9::int[], $10::int[])
                     AS v(id, total, good, scrap, rework)
                WHERE r.id = v.id RETURNING r.id
            )
            UPDATE public.simulator_state
            SET heartbeat_at = now(), sim_now = $11, started_at = $12, running = $13, speed = $14,
                state = $15::jsonb, updated_at = now()
            WHERE id = 1 AND owner = $16
            RETURNING id""",
            [r["id"] for r in prod], [r["planned_quantity"] for r in prod], [r["actual_quantity"] for r in prod],
            [r["runtime_minutes"] for r in prod], [r["load_percent"] for r in prod],
            [r["id"] for r in qual], [r["total_quantity"] for r in qual], [r["good_quantity"] for r in qual],
            [r["scrap_quantity"] for r in qual], [r["rework_quantity"] for r in qual],
            meta["sim_now"], meta["started_at"], meta["running"], meta["speed"],
            json.dumps(state, ensure_ascii=False), owner,
        )
        return row is not None

    async def delete_generated(self, since: datetime) -> None:
        """Удаляет всё, что сгенерировал симулятор начиная с момента since (смены удаляют записи каскадом)."""
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM public.incidents WHERE created_at >= $1", since)
                await conn.execute("DELETE FROM public.downtime_events WHERE started_at >= $1", since)
                await conn.execute("DELETE FROM public.shifts WHERE end_at > $1", since)
                await conn.execute("UPDATE public.equipment SET status = 'running'")

    @staticmethod
    def _state_row(row) -> dict | None:
        if row is None:
            return None
        out = dict(row)
        if isinstance(out.get("state"), str):
            out["state"] = json.loads(out["state"])
        return out
