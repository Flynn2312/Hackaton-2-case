from datetime import datetime
from typing import Any

from asyncpg import Connection


async def get_factories(conn: Connection) -> list[dict[str, Any]]:
    """Получает список всех заводов, отсортированных по идентификатору"""
    rows = await conn.fetch("SELECT id, name, location, created_at FROM public.factories ORDER BY id")
    return [dict(r) for r in rows]


async def get_factory_by_id(conn: Connection, factory_id: int) -> dict[str, Any] | None:
    """Получает информацию о заводе по его уникальному идентификатору"""
    row = await conn.fetchrow("SELECT id, name, location, created_at FROM public.factories WHERE id = $1", factory_id)
    return dict(row) if row else None


async def get_factory_hierarchy(conn: Connection, factory_id: int) -> list[dict[str, Any]]:
    """Собирает дерево участков и вложенного в них оборудования для фронтенда"""
    areas = await conn.fetch(
        "SELECT id, name, code, sequence FROM public.production_areas WHERE factory_id = $1 ORDER BY sequence",
        factory_id)
    if not areas:
        return []

    area_ids = [a['id'] for a in areas]
    equipment = await conn.fetch(
        "SELECT id, production_area_id, name, code, status, criticality FROM public.equipment WHERE production_area_id = ANY($1)",
        area_ids)

    eq_by_area = {}
    for eq in equipment:
        eq_by_area.setdefault(eq['production_area_id'], []).append(dict(eq))

    hierarchy = []
    for area in areas:
        area_dict = dict(area)
        area_dict['equipment'] = eq_by_area.get(area['id'], [])
        hierarchy.append(area_dict)

    return hierarchy


async def get_production_areas(conn: Connection, factory_id: int | None = None) -> list[dict[str, Any]]:
    """
    Получает список производственных участков.
    :param factory_id: Опциональный фильтр по идентификатору завода.
    """
    query = "SELECT id, factory_id, name, code, sequence FROM public.production_areas"
    args = []
    if factory_id:
        query += " WHERE factory_id = $1"
        args.append(factory_id)
    query += " ORDER BY sequence"
    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_equipment(
        conn: Connection,
        production_area_id: int | None = None,
        status: str | None = None,
        criticality: str | None = None
) -> list[dict[str, Any]]:
    """
    Получает список оборудования с возможностью фильтрации
    :param production_area_id: Фильтр по производственному участку.
    :param status: Фильтр по статусу оборудования.
    :param criticality: Фильтр по степени критичности.
    """
    query = "SELECT id, production_area_id, name, code, status, criticality FROM public.equipment WHERE 1=1"
    args = []

    if production_area_id:
        args.append(production_area_id)
        query += f" AND production_area_id = ${len(args)}"
    if status:
        args.append(status)
        query += f" AND status = ${len(args)}"
    if criticality:
        args.append(criticality)
        query += f" AND criticality = ${len(args)}"

    query += " ORDER BY id"
    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_equipment_by_id(conn: Connection, equipment_id: int) -> dict[str, Any] | None:
    """Получает информацию об оборудовании по его уникальному идентификатору"""
    row = await conn.fetchrow("SELECT * FROM public.equipment WHERE id = $1", equipment_id)
    return dict(row) if row else None


async def get_shifts(
        conn: Connection,
        factory_id: int | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    """
    Получает список смен с поддержкой фильтрации по заводу, периоду времени и пагинацией
    :param factory_id: Фильтр по идентификатору завода.
    :param date_from: Начальная дата/время для фильтрации смен.
    :param date_to: Конечная дата/время для фильтрации смен.
    :param limit: Максимальное количество возвращаемых записей.
    :param offset: Смещение для пагинации.
    """
    query = "SELECT id, factory_id, name, start_at, end_at FROM public.shifts WHERE 1=1"
    args = []

    if factory_id:
        args.append(factory_id)
        query += f" AND factory_id = ${len(args)}"
    if date_from:
        args.append(date_from)
        query += f" AND start_at >= ${len(args)}"
    if date_to:
        args.append(date_to)
        query += f" AND end_at <= ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY start_at DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_shift_by_id(conn: Connection, shift_id: int) -> dict[str, Any] | None:
    """Получает информацию о смене по её уникальному идентификатору"""
    row = await conn.fetchrow("SELECT * FROM public.shifts WHERE id = $1", shift_id)
    return dict(row) if row else None


async def get_car_models(conn: Connection) -> list[dict[str, Any]]:
    """Получает список всех моделей автомобилей, отсортированных по идентификатору"""
    rows = await conn.fetch("SELECT id, name, code, created_at FROM public.car_models ORDER BY id")
    return [dict(r) for r in rows]


async def get_car_model_by_id(conn: Connection, car_model_id: int) -> dict[str, Any] | None:
    """Получает модель автомобиля по её уникальному идентификатору"""
    row = await conn.fetchrow("SELECT id, name, code, created_at FROM public.car_models WHERE id = $1", car_model_id)
    return dict(row) if row else None


async def get_production_area_by_id(conn: Connection, area_id: int) -> dict[str, Any] | None:
    """Получает информацию о производственном участке по его уникальному идентификатору"""
    row = await conn.fetchrow("SELECT * FROM public.production_areas WHERE id = $1", area_id)
    return dict(row) if row else None
