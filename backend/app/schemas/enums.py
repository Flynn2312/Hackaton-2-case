from enum import StrEnum


class EquipmentStatus(StrEnum):
    running = "running"
    idle = "idle"
    maintenance = "maintenance"
    breakdown = "breakdown"


class Criticality(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class DowntimeType(StrEnum):
    breakdown = "breakdown"
    planned_maintenance = "planned_maintenance"
    material_shortage = "material_shortage"
    changeover = "changeover"
    quality_issue = "quality_issue"
    other = "other"


class IncidentSeverity(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class IncidentType(StrEnum):
    equipment_failure = "equipment_failure"
    quality_deviation = "quality_deviation"
    plan_deviation = "plan_deviation"
    downtime_limit = "downtime_limit"
    material_shortage = "material_shortage"
    safety = "safety"


class IncidentStatus(StrEnum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"
