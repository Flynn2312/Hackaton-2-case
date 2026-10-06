from datetime import datetime
from typing import Any

from asyncpg import Connection


async def get_downtime_events(
        conn: Connection,
        equipment_id: int | None = None,
        shift_id: int | None = None,
        type: str | None = None,
        active: bool | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    """
    Получает список событий простоя с возможностью фильтрации по оборудованию, смене, типу, активности, периоду и пагинацией
    :param equipment_id: Фильтр по идентификатору оборудования.
    :param shift_id: Фильтр по идентификатору смены.
    :param type: Фильтр по типу простоя.
    :param active: Фильтр по активности (True — активные простои без даты окончания, False — завершенные).
    :param date_from: Начальная дата/время для фильтрации по времени начала.
    :param date_to: Конечная дата/время для фильтрации по времени начала.
    :param limit: Максимальное количество возвращаемых записей.
    :param offset: Смещение для пагинации.
    """
    query = """
            SELECT id, \
                   equipment_id, \
                   shift_id, \
                   started_at, \
                   ended_at, \
                   duration_minutes, \
                   reason, \
                   type
            FROM public.downtime_events \
            WHERE 1 = 1 \
            """
    args = []

    if equipment_id:
        args.append(equipment_id)
        query += f" AND equipment_id = ${len(args)}"
    if shift_id:
        args.append(shift_id)
        query += f" AND shift_id = ${len(args)}"
    if type:
        args.append(type)
        query += f" AND type = ${len(args)}"

    if active is True:
        query += " AND ended_at IS NULL"
    elif active is False:
        query += " AND ended_at IS NOT NULL"

    if date_from:
        args.append(date_from)
        query += f" AND started_at >= ${len(args)}"
    if date_to:
        args.append(date_to)
        query += f" AND started_at <= ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY started_at DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_downtime_event_by_id(conn: Connection, event_id: int) -> dict[str, Any] | None:
    """
    Получает информацию о событии простоя по его уникальному идентификатору
    :param event_id: Идентификатор события простоя.
    """
    row = await conn.fetchrow("SELECT * FROM public.downtime_events WHERE id = $1", event_id)
    return dict(row) if row else None


async def get_incidents(
        conn: Connection,
        production_area_id: int | None = None,
        equipment_id: int | None = None,
        shift_id: int | None = None,
        status: str | None = None,
        severity: str | None = None,
        type: str | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        limit: int = 100,
        offset: int = 0
) -> list[dict[str, Any]]:
    """
    Получает список инцидентов с возможностью гибкой фильтрации по участку, оборудованию, смене, статусу, критичности, типу, периоду и пагинацией
    :param production_area_id: Фильтр по идентификатору производственного участка.
    :param equipment_id: Фильтр по идентификатору оборудования.
    :param shift_id: Фильтр по идентификатору смены.
    :param status: Фильтр по статусу инцидента.
    :param severity: Фильтр по степени критичности (severity).
    :param type: Фильтр по типу инцидента.
    :param date_from: Начальная дата/время для фильтрации по дате создания.
    :param date_to: Конечная дата/время для фильтрации по дате создания.
    :param limit: Максимальное количество возвращаемых записей.
    :param offset: Смещение для пагинации.
    """
    query = """
            SELECT id, \
                   production_area_id, \
                   equipment_id, \
                   shift_id, \
                   created_at, \
                   severity, \
                   type, \
                   title, \
                   description, \
                   status
            FROM public.incidents \
            WHERE 1 = 1 \
            """
    args = []

    filters = {
        "production_area_id": production_area_id,
        "equipment_id": equipment_id,
        "shift_id": shift_id,
        "status": status,
        "severity": severity,
        "type": type
    }

    for col, val in filters.items():
        if val is not None:
            args.append(val)
            query += f" AND {col} = ${len(args)}"

    if date_from:
        args.append(date_from)
        query += f" AND created_at >= ${len(args)}"
    if date_to:
        args.append(date_to)
        query += f" AND created_at <= ${len(args)}"

    args.extend([limit, offset])
    query += f" ORDER BY created_at DESC LIMIT ${len(args) - 1} OFFSET ${len(args)}"

    rows = await conn.fetch(query, *args)
    return [dict(r) for r in rows]


async def get_incident_by_id(conn: Connection, incident_id: int) -> dict[str, Any] | None:
    """
    Получает информацию об инциденте по его уникальному идентификатору.
    :param incident_id: Идентификатор инцидента.
    """
    row = await conn.fetchrow("SELECT * FROM public.incidents WHERE id = $1", incident_id)
    return dict(row) if row else None
