from datetime import datetime

from supabase import Client

from app.schemas.enums import DowntimeType, IncidentSeverity, IncidentStatus, IncidentType
from app.schemas.events import DowntimeEvent, Incident
from app.services.base import apply_filters, apply_period, get_by_id, paginate


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
    rows = paginate(query.order("started_at", desc=True), limit, offset).execute().data
    return [DowntimeEvent(**r) for r in rows]


def get_downtime_event(db: Client, event_id: int) -> DowntimeEvent | None:
    row = get_by_id(db, "downtime_events", event_id)
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
    rows = paginate(query.order("created_at", desc=True), limit, offset).execute().data
    return [Incident(**r) for r in rows]


def get_incident(db: Client, incident_id: int) -> Incident | None:
    row = get_by_id(db, "incidents", incident_id)
    return Incident(**row) if row else None
