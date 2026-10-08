import copy

from fastapi import APIRouter, HTTPException

from app.simulator.assistant import ChatRequest, chat
from app.simulator.hub import jsonable
from app.simulator.runner import runner

assistant_router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@assistant_router.post("/chat")
async def assistant_chat(req: ChatRequest):
    """
    ИИ-ассистент завода: отвечает только по данным цифрового двойника и только о производстве.
    503 — ИИ недоступен (нет ключа или ошибка API): фронт отвечает по встроенным правилам.
    """
    if runner.store is None:
        raise HTTPException(status_code=503, detail="Нет подключения к БД")
    if runner.is_owner and runner.engine:
        async with runner.lock:
            snapshot, refs = copy.deepcopy(runner.engine.st), runner.engine.refs
    else:
        row = await runner.store.read_state()
        if not row or not (row.get("state") or {}).get("sim_now"):
            raise HTTPException(status_code=503, detail="Симуляция завода ещё не запущена")
        snapshot, refs = row["state"], await runner.store.load_refs()
    result = await chat(runner.store.pool, snapshot, refs, req)
    if result is None:
        raise HTTPException(status_code=503, detail="ИИ-ассистент недоступен")
    return {"data": jsonable(result)}
