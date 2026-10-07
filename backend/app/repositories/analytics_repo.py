import asyncpg
from typing import Dict, Any, List
from datetime import datetime

async def calculate_quality_metrics(
    conn: asyncpg.Connection,
    date_from: datetime,
    date_to: datetime
) -> Dict[str, Any]:
    """Считает общую статистику по браку за период"""
    query = """
        SELECT 
            COALESCE(SUM(total_quantity), 0) as total_produced,
            COALESCE(SUM(good_quantity), 0) as total_good,
            COALESCE(SUM(scrap_quantity), 0) as total_scrap,
            CASE 
                WHEN SUM(total_quantity) > 0 
                THEN ROUND((SUM(scrap_quantity)::numeric / SUM(total_quantity)::numeric) * 100, 2)
                ELSE 0 
            END as scrap_percentage
        FROM public.quality_records
        WHERE timestamp >= $1 AND timestamp <= $2
    """
    row = await conn.fetchrow(query, date_from, date_to)
    return dict(row)

async def calculate_downtime_stats(
    conn: asyncpg.Connection,
    date_from: datetime,
    date_to: datetime
) -> List[Dict[str, Any]]:
    """Группирует простои по типам (ошибка датчика, плановое ТО и т.д.)"""
    query = """
        SELECT 
            type,
            COALESCE(SUM(duration_minutes), 0) as total_minutes,
            COUNT(id) as event_count
        FROM public.downtime_events
        WHERE started_at >= $1 AND started_at <= $2
        GROUP BY type
        ORDER BY total_minutes DESC
    """
    rows = await conn.fetch(query, date_from, date_to)
    return [dict(r) for r in rows]

async def calculate_production_progress(conn: asyncpg.Connection, shift_id: int) -> List[Dict[str, Any]]:
    """Сравнивает план и факт по участкам для конкретной смены"""
    query = """
        SELECT 
            pa.name as area_name,
            cm.name as car_model,
            pp.planned_quantity as planned,
            COALESCE(SUM(pr.actual_quantity), 0) as actual,
            CASE 
                WHEN pp.planned_quantity > 0 
                THEN ROUND((COALESCE(SUM(pr.actual_quantity), 0)::numeric / pp.planned_quantity::numeric) * 100, 2)
                ELSE 0 
            END as completion_percent
        FROM public.production_plans pp
        JOIN public.car_models cm ON pp.car_model_id = cm.id
        JOIN public.production_areas pa ON pa.factory_id = pp.factory_id
        LEFT JOIN public.production_records pr ON 
            pr.shift_id = pp.shift_id AND 
            pr.car_model_id = pp.car_model_id AND 
            pr.production_area_id = pa.id
        WHERE pp.shift_id = $1
        GROUP BY pa.name, cm.name, pp.planned_quantity
    """
    rows = await conn.fetch(query, shift_id)
    return [dict(r) for r in rows]


async def calculate_oee(
    conn: asyncpg.Connection,
    factory_id: int,
    date_from: datetime,
    date_to: datetime
) -> Dict[str, Any]:
    """Расчет OEE (Overall Equipment Effectiveness) = Доступность * Производительность * Качество"""
    # 1. Качество (Quality) = Годные детали / Всего произведено
    quality_query = """
        SELECT COALESCE(SUM(good_quantity)::numeric / NULLIF(SUM(total_quantity), 0), 1) as quality_rate
        FROM public.quality_records qr
        JOIN public.shifts s ON qr.shift_id = s.id
        WHERE s.factory_id = $1 AND qr.timestamp >= $2 AND qr.timestamp <= $3
    """
    q_rate = await conn.fetchval(quality_query, factory_id, date_from, date_to) or 1.0

    # 2. Производительность (Performance) = Факт / План
    perf_query = """
        SELECT COALESCE(SUM(actual_quantity)::numeric / NULLIF(SUM(planned_quantity), 0), 1) as perf_rate
        FROM public.production_records pr
        JOIN public.shifts s ON pr.shift_id = s.id
        WHERE s.factory_id = $1 AND pr.timestamp >= $2 AND pr.timestamp <= $3
    """
    p_rate = await conn.fetchval(perf_query, factory_id, date_from, date_to) or 1.0
    p_rate = min(float(p_rate), 1.0)

    # 3. Доступность (Availability) = (Запланированное время работы - Простои) / Запланированное время
    avail_query = """
        WITH shift_hours AS (
            SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (end_at - start_at))/60), 0) as total_planned_minutes
            FROM public.shifts 
            WHERE factory_id = $1 AND start_at >= $2 AND start_at <= $3
        ),
        downtime AS (
            SELECT COALESCE(SUM(duration_minutes), 0) as total_downtime
            FROM public.downtime_events de
            JOIN public.shifts s ON de.shift_id = s.id
            WHERE s.factory_id = $1 AND de.started_at >= $2 AND de.started_at <= $3
        )
        SELECT 
            total_planned_minutes,
            total_downtime,
            CASE 
                WHEN total_planned_minutes > 0 THEN GREATEST((total_planned_minutes - total_downtime) / total_planned_minutes, 0)
                ELSE 1.0 
            END as avail_rate
        FROM shift_hours, downtime
    """
    avail_row = await conn.fetchrow(avail_query, factory_id, date_from, date_to)
    a_rate = float(avail_row['avail_rate']) if avail_row else 1.0

    oee = float(a_rate) * float(p_rate) * float(q_rate)

    return {
        "oee_percent": round(oee * 100, 2),
        "components": {
            "availability_percent": round(float(a_rate) * 100, 2),
            "performance_percent": round(float(p_rate) * 100, 2),
            "quality_percent": round(float(q_rate) * 100, 2)
        },
        "target_percent": 85.0
    }