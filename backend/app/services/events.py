from datetime import datetime

from supabase import Client

from app.schemas.enums import DowntimeType, IncidentSeverity, IncidentStatus, IncidentType
from app.schemas.events import DowntimeEvent, Incident
from app.services.base import apply_filters, apply_period, get_by_id, paginate, safe_select

FALLBACK_DOWNTIME = [
    {"id": 1, "equipment_id": 1, "shift_id": 1, "type": "breakdown", "reason": "Обрыв цепи", "started_at": "2026-10-02T10:00:00+05:00", "ended_at": "2026-10-02T10:55:00+05:00", "duration_minutes": 55},
    {"id": 2, "equipment_id": 3, "shift_id": 1, "type": "planned_maintenance", "reason": "Плановое ТО", "started_at": "2026-10-02T12:00:00+05:00", "ended_at": "2026-10-02T12:30:00+05:00", "duration_minutes": 30},
]

FALLBACK_INCIDENTS = [
    {"id": 1, "production_area_id": 4, "equipment_id": 1, "shift_id": 1, "title": "Предаварийный уровень вибрации Конвейера-03 (6.8 мм/с)", "status": "open", "severity": "critical", "type": "equipment_failure", "created_at": "2026-10-02T09:45:00+05:00"},
    {"id": 2, "production_area_id": 3, "equipment_id": 2, "shift_id": 1, "title": "Рост брака ЛКП до 5.2% (перегрев сушильной печи)", "status": "in_progress", "severity": "high", "type": "quality_deviation", "created_at": "2026-10-02T11:20:00+05:00"},
]


def list_downtime_events(
    db: Client,
    limit: int,
    offset: int,
    equipment_id: int | None = None,
    shift_id: int | None = None,
    type: DowntimeType | None = None,
    active: bool | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[DowntimeEvent]:
    query = apply_filters(
        db.table("downtime_events").select("*"), equipment_id=equipment_id, shift_id=shift_id, type=type,
    )
    if active is True:
        query = query.is_("ended_at", "null")
    elif active is False:
        query = query.not_.is_("ended_at", "null")
    query = apply_period(query, "started_at", date_from, date_to)
    rows = safe_select(paginate(query.order("started_at", desc=True), limit, offset), FALLBACK_DOWNTIME)
    return [DowntimeEvent(**r) for r in rows]


def get_downtime_event(db: Client, event_id: int) -> DowntimeEvent | None:
    row = get_by_id(db, "downtime_events", event_id)
    if not row:
        row = next((d for d in FALLBACK_DOWNTIME if d["id"] == event_id), None)
    return DowntimeEvent(**row) if row else None


def list_incidents(
    db: Client,
    limit: int,
    offset: int,
    production_area_id: int | None = None,
    equipment_id: int | None = None,
    shift_id: int | None = None,
    status: IncidentStatus | None = None,
    severity: IncidentSeverity | None = None,
    type: IncidentType | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[Incident]:
    query = apply_filters(
        db.table("incidents").select("*"),
        production_area_id=production_area_id, equipment_id=equipment_id, shift_id=shift_id,
        status=status, severity=severity, type=type,
    )
    query = apply_period(query, "created_at", date_from, date_to)
    rows = safe_select(paginate(query.order("created_at", desc=True), limit, offset), FALLBACK_INCIDENTS)
    return [Incident(**r) for r in rows]


def get_incident(db: Client, incident_id: int) -> Incident | None:
    row = get_by_id(db, "incidents", incident_id)
    if not row:
        row = next((i for i in FALLBACK_INCIDENTS if i["id"] == incident_id), None)
    return Incident(**row) if row else None
