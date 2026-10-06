from datetime import datetime

from fastapi import APIRouter, Query

from app.api.deps import DB, Page, found
from app.schemas.enums import DowntimeType, IncidentSeverity, IncidentStatus, IncidentType
from app.schemas.events import DowntimeEvent, Incident
from app.services import events as service

router = APIRouter()


@router.get("/downtime-events", response_model=list[DowntimeEvent], tags=["downtime events"])
def list_downtime_events(
    db: DB,
    page: Page,
    equipment_id: int | None = None,
    shift_id: int | None = None,
    type: DowntimeType | None = None,
    active: bool | None = Query(None, description="true — только незавершённые простои, false — только завершённые"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    return service.list_downtime_events(
        db, page.limit, page.offset, equipment_id, shift_id, type, active, date_from, date_to
    )


@router.get("/downtime-events/{event_id}", response_model=DowntimeEvent, tags=["downtime events"])
def get_downtime_event(event_id: int, db: DB):
    return found(service.get_downtime_event(db, event_id), "Downtime event")


@router.get("/incidents", response_model=list[Incident], tags=["incidents"])
def list_incidents(
    db: DB,
    page: Page,
    production_area_id: int | None = None,
    equipment_id: int | None = None,
    shift_id: int | None = None,
    status: IncidentStatus | None = None,
    severity: IncidentSeverity | None = None,
    type: IncidentType | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
):
    return service.list_incidents(
        db, page.limit, page.offset, production_area_id, equipment_id, shift_id,
        status, severity, type, date_from, date_to,
    )


@router.get("/incidents/{incident_id}", response_model=Incident, tags=["incidents"])
def get_incident(incident_id: int, db: DB):
    return found(service.get_incident(db, incident_id), "Incident")
