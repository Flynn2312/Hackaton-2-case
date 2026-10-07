from fastapi import APIRouter, WebSocket

digital_twin_router = APIRouter(tags=["digital-twin"])

@digital_twin_router.get("/api/digital-twin/live-status")
async def get_live_status(factory_id: int):
    pass

@digital_twin_router.websocket("/ws/digital-twin/stream")
async def websocket_digital_twin_stream(websocket: WebSocket):
    """Стриминг событий (смена статуса оборудования, инциденты) в реальном времени"""
    await websocket.accept()
    # Логика отправки JSON с обновлениями