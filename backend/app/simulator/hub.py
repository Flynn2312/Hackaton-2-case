import asyncio
import json
import logging
from datetime import date, datetime
from decimal import Decimal
from typing import Any

logger = logging.getLogger(__name__)

QUEUE_SIZE = 500


def jsonable(value: Any) -> Any:
    """Приводит строки asyncpg (datetime, Decimal) к JSON-совместимому виду."""
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


class EventHub:
    """Рассылка событий симулятора всем подключённым WebSocket-клиентам этого инстанса."""

    def __init__(self):
        self._clients: set[asyncio.Queue] = set()

    @property
    def clients(self) -> int:
        return len(self._clients)

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
        self._clients.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._clients.discard(queue)

    def publish(self, message: dict) -> None:
        if not self._clients:
            return
        text = json.dumps(jsonable(message), ensure_ascii=False)
        for queue in list(self._clients):
            try:
                queue.put_nowait(text)
            except asyncio.QueueFull:
                # Клиент не успевает читать — отключаем, после переподключения он перечитает данные целиком
                logger.warning("WS-клиент не успевает за потоком событий, отключаю")
                self._clients.discard(queue)
                while not queue.empty():
                    queue.get_nowait()
                queue.put_nowait(None)  # сигнал WS-обработчику закрыть соединение

    def upsert(self, table: str, *rows: dict) -> None:
        rows = [r for r in rows if r]
        if rows:
            self.publish({"type": "upsert", "table": table, "rows": rows})

    def notice(self, level: str, title: str, text: str = "", **extra: Any) -> None:
        """Короткое уведомление для тоста на фронте. level: r — критично, y — внимание, g — норма, n — инфо."""
        self.publish({"type": "notice", "level": level, "title": title, "text": text, **extra})


hub = EventHub()
