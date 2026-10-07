from datetime import datetime
from typing import Any

from asyncpg import Connection


async def get_production_plans(
        conn: Connection,
        factory_id: int | None = None,
        shift_id: int | None = None,
        car_model_id: int | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    query = "SELECT id, factory_id, shift_id, car_model_id, planned_quantity FROM public.production_plans WHERE 1=1"
    args = []

    if factory_id:
        args.append(factory_id)
        query += f" AND factory_id = ${len(args)}"
    if shift_id:
        args.append(shift_id)
        query += f" AND shift_id = ${len(args)}"
    if car_model_id:
        args.append(car_model_id)
        query += f" AND car_model_id = ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY id LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_production_records(
        conn: Connection,
        shift_id: int | None = None,
        production_area_id: int | None = None,
        car_model_id: int | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    query = """
            SELECT id, \
                   shift_id, \
                   production_area_id, \
                   car_model_id, timestamp, planned_quantity, actual_quantity, runtime_minutes, load_percent
            FROM public.production_records \
            WHERE 1=1 \
            """
    args = []

    if shift_id:
        args.append(shift_id)
        query += f" AND shift_id = ${len(args)}"
    if production_area_id:
        args.append(production_area_id)
        query += f" AND production_area_id = ${len(args)}"
    if car_model_id:
        args.append(car_model_id)
        query += f" AND car_model_id = ${len(args)}"
    if date_from:
        args.append(date_from)
        query += f" AND timestamp >= ${len(args)}"
    if date_to:
        args.append(date_to)
        query += f" AND timestamp <= ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY timestamp DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_quality_records(
        conn: Connection,
        shift_id: int | None = None,
        production_area_id: int | None = None,
        car_model_id: int | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    query = """
            SELECT id, \
                   shift_id, \
                   production_area_id, \
                   car_model_id, timestamp, total_quantity, good_quantity, scrap_quantity, rework_quantity
            FROM public.quality_records \
            WHERE 1=1 \
            """
    args = []

    if shift_id:
        args.append(shift_id)
        query += f" AND shift_id = ${len(args)}"
    if production_area_id:
        args.append(production_area_id)
        query += f" AND production_area_id = ${len(args)}"
    if car_model_id:
        args.append(car_model_id)
        query += f" AND car_model_id = ${len(args)}"
    if date_from:
        args.append(date_from)
        query += f" AND timestamp >= ${len(args)}"
    if date_to:
        args.append(date_to)
        query += f" AND timestamp <= ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY timestamp DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]
