import asyncio
import json

from asyncpg import Connection
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.core.database import get_db
from app.simulator.hub import hub, jsonable
from app.simulator.runner import runner

digital_twin_router = APIRouter(tags=["digital-twin"])


@digital_twin_router.get("/api/digital-twin/live-status")
async def get_live_status(factory_id: int | None = None, conn: Connection = Depends(get_db)):
    """Текущее состояние завода: симуляционные часы, статусы оборудования, идущие простои, открытые инциденты"""
    area_filter = "WHERE a.factory_id = $1" if factory_id else ""
    args = [factory_id] if factory_id else []
    equipment = await conn.fetch(f"""
        SELECT e.id, e.code, e.name, e.status, e.criticality, e.production_area_id
        FROM public.equipment e JOIN public.production_areas a ON a.id = e.production_area_id
        {area_filter} ORDER BY e.id""", *args)
    downtime = await conn.fetch("SELECT * FROM public.downtime_events WHERE ended_at IS NULL ORDER BY started_at")
    incidents = await conn.fetch(
        "SELECT * FROM public.incidents WHERE status IN ('open', 'in_progress') ORDER BY created_at DESC LIMIT 100")
    sim = await runner.status()
    return {"data": jsonable({
        "simulator": sim,
        "equipment": [dict(r) for r in equipment],
        "active_downtime": [dict(r) for r in downtime],
        "open_incidents": [dict(r) for r in incidents],
    })}


@digital_twin_router.websocket("/ws/digital-twin/stream")
async def websocket_digital_twin_stream(websocket: WebSocket):
    """
    Стриминг событий симулятора в реальном времени. Сообщения (JSON):
    - {"type": "hello" | "clock", "sim_now", "speed", "running", ...} — симуляционные часы;
    - {"type": "upsert", "table", "rows"} — новые или изменённые строки таблиц (оборудование, простои, инциденты,
      почасовая выработка и качество, смены, планы);
    - {"type": "notice", "level", "title", "text"} — уведомление для тоста;
    - {"type": "reload"} — перечитать данные целиком (перезапуск или сброс симуляции).
    Клиент может слать "ping" — ответ "pong" (держит соединение и не даёт free-инстансу Render уснуть).
    """
    await websocket.accept()
    queue = hub.subscribe()
    try:
        status = await runner.status()
        await websocket.send_text(json.dumps(jsonable({"type": "hello", **status}), ensure_ascii=False))

        async def receive():
            while True:
                if await websocket.receive_text() == "ping":
                    await websocket.send_text('{"type":"pong"}')

        async def send():
            while True:
                text = await queue.get()
                if text is None:
                    return
                await websocket.send_text(text)

        tasks = [asyncio.create_task(receive()), asyncio.create_task(send())]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            if task.exception() and not isinstance(task.exception(), WebSocketDisconnect):
                raise task.exception()
    except WebSocketDisconnect:
        pass
    finally:
        hub.unsubscribe(queue)
