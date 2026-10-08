from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.simulator.engine import SCENARIOS
from app.simulator.hub import jsonable
from app.simulator.runner import NotOwnerError, runner

simulator_router = APIRouter(prefix="/api/sim", tags=["simulator"])


class SpeedRequest(BaseModel):
    speed: float = Field(..., ge=1, le=3600, description="Симуляционных секунд за реальную секунду (60 — минута завода за секунду)")


class InjectRequest(BaseModel):
    scenario: str = Field(..., description=f"Один из: {', '.join(SCENARIOS)}")


async def _control(action):
    try:
        result = await action
    except NotOwnerError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"data": jsonable({"result": result, "status": await runner.status()})}


@simulator_router.get("/status")
async def get_status():
    """Симуляционные часы, скорость, кто генерирует, доступные сценарии"""
    return {"data": jsonable(await runner.status())}


@simulator_router.post("/pause")
async def pause():
    return await _control(runner.set_running(False))


@simulator_router.post("/resume")
async def resume():
    return await _control(runner.set_running(True))


@simulator_router.post("/speed")
async def set_speed(body: SpeedRequest):
    return await _control(runner.set_speed(body.speed))


@simulator_router.post("/inject")
async def inject(body: InjectRequest):
    """Вызвать сценарий: обрыв цепи конвейера, рост брака окраски, нехватка комплектующих и т.д."""
    return await _control(runner.inject(body.scenario))


@simulator_router.post("/reset")
async def reset():
    """Удалить сгенерированные данные и начать симуляцию заново с текущего момента"""
    return await _control(runner.reset())
