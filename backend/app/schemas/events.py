from datetime import datetime

from pydantic import BaseModel

from app.schemas.enums import DowntimeType, IncidentSeverity, IncidentStatus, IncidentType


class DowntimeEvent(BaseModel):
    id: int
    equipment_id: int
    shift_id: int | None = None
    started_at: datetime
    ended_at: datetime | None = None
    duration_minutes: int | None = None
    reason: str
    type: DowntimeType


class Incident(BaseModel):
    id: int
    production_area_id: int
    equipment_id: int | None = None
    shift_id: int | None = None
    created_at: datetime
    severity: IncidentSeverity
    type: IncidentType
    title: str
    description: str | None = None
    status: IncidentStatus
