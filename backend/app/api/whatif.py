import copy

from fastapi import APIRouter, HTTPException

from app.simulator.hub import jsonable
from app.simulator.runner import runner
from app.simulator.whatif import WhatIfScenario, forecast_whatif

whatif_router = APIRouter(prefix="/api/whatif", tags=["what-if"])


@whatif_router.post("/forecast")
async def forecast(scenario: WhatIfScenario):
    """
    Прогноз сценария What-If: копия живого завода прогоняется на 8 часов работы линии со сценарием и без него,
    затем ИИ коротко объясняет, к чему это приведёт, почему и как действовать.
    """
    if runner.is_owner and runner.engine:
        async with runner.lock:  # снимок между шагами симуляции
            snapshot, refs = copy.deepcopy(runner.engine.st), runner.engine.refs
    else:
        row = await runner.store.read_state() if runner.store else None
        if not row or not (row.get("state") or {}).get("shift"):
            raise HTTPException(status_code=503, detail="Симуляция завода ещё не запущена — прогнозировать не от чего")
        snapshot, refs = row["state"], await runner.store.load_refs()
    return {"data": jsonable(await forecast_whatif(snapshot, refs, scenario))}
