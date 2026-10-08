"""GET /api/losses — выпуск и потери по участкам (данные кейса из case_data.py)."""
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.services import case_data as cd
from app.services.losses import losses_for_date

losses_router = APIRouter(prefix="/api/losses", tags=["losses"])


def _available_dates() -> list[str]:
    return sorted({p["date"] for p in cd.PRODUCTION}, key=lambda d: datetime.strptime(d, "%d.%m.%Y"))


def _to_case_date(value: str) -> str:
    """Принимает 2026-10-01 или 01.10.2026, отдаёт формат case_data (ДД.ММ.ГГГГ)."""
    for fmt in ("%Y-%m-%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%d.%m.%Y")
        except ValueError:
            pass
    raise HTTPException(status_code=422, detail="Дата в формате ГГГГ-ММ-ДД или ДД.ММ.ГГГГ")


@losses_router.get("")
async def get_losses(date: str | None = Query(None, description="По умолчанию — последний день в данных кейса")):
    dates = _available_dates()
    day = _to_case_date(date) if date else dates[-1]
    if day not in dates:
        raise HTTPException(status_code=404, detail=f"Нет данных за {day}. Доступно: {', '.join(dates)}")
    return {"data": {"date": day, "available_dates": dates, **losses_for_date(day)}}
