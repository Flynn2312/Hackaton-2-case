from datetime import datetime
from typing import Any

from postgrest import SyncSelectRequestBuilder
from supabase import Client


def apply_filters(query: SyncSelectRequestBuilder, **filters: Any) -> SyncSelectRequestBuilder:
    """Фильтр на равенство для каждого переданного (не None) значения."""
    for column, value in filters.items():
        if value is not None:
            query = query.eq(column, value)
    return query


def apply_period(
    query: SyncSelectRequestBuilder, column: str, date_from: datetime | None, date_to: datetime | None
) -> SyncSelectRequestBuilder:
    """Полуинтервал [date_from, date_to)."""
    if date_from is not None:
        query = query.gte(column, date_from.isoformat())
    if date_to is not None:
        query = query.lt(column, date_to.isoformat())
    return query


def paginate(query: SyncSelectRequestBuilder, limit: int, offset: int) -> SyncSelectRequestBuilder:
    return query.range(offset, offset + limit - 1)


def safe_select(query: SyncSelectRequestBuilder, fallback: list = None) -> list:
    try:
        res = query.execute()
        return res.data if res and res.data is not None else (fallback or [])
    except Exception:
        return fallback or []


def get_by_id(db: Client, table: str, row_id: int) -> dict | None:
    try:
        rows = db.table(table).select("*").eq("id", row_id).limit(1).execute().data
        return rows[0] if rows else None
    except Exception:
        return None
