import json

from asyncpg import Connection
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.simulator.hub import jsonable
from app.simulator.runner import NotOwnerError, runner

decisions_router = APIRouter(prefix="/api", tags=["decisions"])


class DecisionRequest(BaseModel):
    choice: str = Field(..., pattern="^(none|A|B)$", description="none — ничего не менять, A или B — вариант ИИ")


def _row(r) -> dict:
    out = dict(r)
    if isinstance(out.get("payload"), str):
        out["payload"] = json.loads(out["payload"])
    return out


@decisions_router.get("/decisions")
async def list_decisions(
        active: bool | None = Query(None, description="true — только ожидающие решения оператора"),
        incident_id: int | None = Query(None),
        limit: int = Query(100, ge=1, le=1000),
        conn: Connection = Depends(get_db),
):
    """Варианты решения инцидентов: анализ, таблица прогноза, аргументация, рекомендация ИИ и выбор оператора"""
    where, args = [], []
    if active:
        where.append("status IN ('generating', 'ready')")
    if incident_id:
        args.append(incident_id)
        where.append(f"id = ${len(args)}")
    args.append(limit)
    rows = await conn.fetch(
        f"SELECT * FROM public.incident_decisions {'WHERE ' + ' AND '.join(where) if where else ''} "
        f"ORDER BY created_at DESC LIMIT ${len(args)}", *args)
    return {"data": jsonable([_row(r) for r in rows])}


@decisions_router.post("/incidents/{incident_id}/decision")
async def decide(incident_id: int, body: DecisionRequest):
    """Решение оператора по инциденту: применяет выбранный вариант в симуляции завода"""
    try:
        title = await runner.decide(incident_id, body.choice)
    except NotOwnerError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"data": {"result": title}}
