"""
Фоновый запуск симулятора внутри процесса API.

- Генерирует только один инстанс: право генерировать — аренда в simulator_state (heartbeat раз в несколько секунд).
  Остальные инстансы ждут и забирают аренду, если владелец пропал (деплой, засыпание Render).
- Темп: speed симуляционных секунд за реальную секунду (60 — минута завода за секунду).
  Если шаги не успевают (медленная БД), отставание догоняется пачкой шагов.
- Текущий час выработки рассылается клиентам каждый шаг, а в БД сохраняется раз в SAVE_EVERY секунд
  и сразу после любых вставок, чтобы состояние движка не расходилось с БД.
"""
import asyncio
import logging
import socket
from datetime import datetime
from uuid import uuid4

from asyncpg.pool import Pool

from app.simulator.engine import SCENARIOS, PlantSimulator
from app.simulator.hub import EventHub, hub
from app.simulator.plant import TZ
from app.simulator.store import SimStore

logger = logging.getLogger(__name__)

SAVE_EVERY = 3.0      # с, сохранение состояния и продление аренды
STANDBY_POLL = 10.0   # с, как часто инстанс без аренды пробует её забрать
RETRY_AFTER = 10.0    # с, пауза после ошибки
MAX_CATCHUP = 30      # шагов за итерацию при отставании


class NotOwnerError(RuntimeError):
    pass


class SimulatorRunner:
    def __init__(self, events: EventHub):
        self.instance = f"{socket.gethostname()}-{uuid4().hex[:8]}"
        self.hub = events
        self.store: SimStore | None = None
        self.engine: PlantSimulator | None = None
        self.task: asyncio.Task | None = None
        self.lock = asyncio.Lock()
        self.is_owner = False
        self.running = True
        self.speed = 60.0
        self.last_error: str | None = None
        self._saved_inserts = 0

    # ---------------------------------------------------------------- жизненный цикл

    def attach(self, pool: Pool) -> None:
        """Доступ к состоянию симуляции в БД (статус, часы) — даже если генерация на этом инстансе выключена."""
        self.store = SimStore(pool)

    def start(self) -> None:
        self.task = asyncio.create_task(self._main(), name="plant-simulator")
        logger.info("Симулятор запущен, инстанс %s", self.instance)

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
        if self.is_owner and self.store:
            try:
                async with self.lock:
                    await self._save()
                await self.store.release_lease(self.instance)
            except Exception as e:
                logger.warning("Симулятор: не удалось сохранить состояние при остановке: %s", e)
        self.is_owner = False

    async def _main(self) -> None:
        while True:
            try:
                row = await self.store.acquire_lease(self.instance)
                if row is None:
                    self.is_owner = False
                    await asyncio.sleep(STANDBY_POLL)
                    continue
                self.is_owner = True
                self.last_error = None
                await self._run(row)
                logger.warning("Симулятор: аренду перехватил другой инстанс, перехожу в ожидание")
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("Симулятор: ошибка, перезапуск через %.0f с", RETRY_AFTER)
                self.last_error = f"{type(e).__name__}: {e}"
            self.is_owner = False
            self.engine = None
            await asyncio.sleep(RETRY_AFTER)

    async def _run(self, row: dict) -> None:
        engine = PlantSimulator(self.store, self.hub)
        mode = await engine.init(row.get("state"), datetime.now(TZ))
        self.running = row.get("running", True)
        self.speed = float(row.get("speed") or 60)
        async with self.lock:
            self.engine = engine
            if not await self._save():
                return
        logger.info("Симулятор: %s, время завода %s, скорость x%g", mode, engine.now, self.speed)
        self.hub.publish({"type": "reload"})  # клиенты перечитывают данные целиком

        loop = asyncio.get_running_loop()
        last_tick = last_save = loop.time()
        debt = 0.0
        while True:
            now = loop.time()
            if self.running:
                debt += (now - last_tick) * self.speed / 60
            last_tick = now
            steps = min(int(debt), MAX_CATCHUP)
            debt = min(debt - steps, 1.0)

            async with self.lock:
                for _ in range(steps):
                    await self.engine.step()  # self.engine, а не локальный engine: reset() подменяет движок
                if steps:
                    self._publish_live()
                if now - last_save >= SAVE_EVERY or self.store.inserts != self._saved_inserts:
                    if not await self._save():
                        return
                    last_save = now

            wait = (1 - debt) * 60 / self.speed if self.running else 1.0
            await asyncio.sleep(min(max(wait, 0.02), 1.0))

    async def _save(self) -> bool:
        engine = self.engine
        rows = engine.finished_rows + engine.current_rows()
        meta = {"sim_now": engine.now, "started_at": engine.started_at, "running": self.running, "speed": self.speed}
        inserts = self.store.inserts
        ok = await self.store.save(self.instance, meta, engine.st, [p for p, _ in rows], [q for _, q in rows])
        if ok:
            engine.finished_rows.clear()
            self._saved_inserts = inserts
        return ok

    def _publish_live(self) -> None:
        rows = self.engine.current_rows()
        self.hub.upsert("production_records", *(p for p, _ in rows))
        self.hub.upsert("quality_records", *(q for _, q in rows))
        self.hub.publish({"type": "clock", **self._clock()})

    def _clock(self) -> dict:
        engine = self.engine
        return {
            "sim_now": engine.now if engine else None, "speed": self.speed, "running": self.running,
            "buffers": engine.st.get("buffers") if engine else None,
        }

    # ---------------------------------------------------------------- управление

    async def status(self) -> dict:
        base = {"instance": self.instance, "is_owner": self.is_owner, "clients": self.hub.clients,
                "last_error": self.last_error,
                "scenarios": [{"key": k, "title": v["title"]} for k, v in SCENARIOS.items()]}
        if self.is_owner and self.engine:
            return {**base, "active": True, **self._clock(), "started_at": self.engine.started_at}
        try:
            row = await self.store.read_state() if self.store else None
        except Exception as e:  # например, не выполнена миграция 002_simulator.sql
            row = None
            base["last_error"] = f"{type(e).__name__}: {e}"
        if not row:
            return {**base, "active": False, "sim_now": None, "speed": None, "running": False, "started_at": None}
        alive = row["heartbeat_at"] is not None and (datetime.now(TZ) - row["heartbeat_at"]).total_seconds() < 20
        return {**base, "active": alive, "sim_now": row["sim_now"], "speed": row["speed"],
                "running": row["running"], "started_at": row["started_at"], "buffers": row["state"].get("buffers")}

    def _require_owner(self) -> PlantSimulator:
        if not (self.is_owner and self.engine):
            raise NotOwnerError("Симулятор не запущен на этом инстансе")
        return self.engine

    async def set_running(self, running: bool) -> None:
        self._require_owner()
        async with self.lock:
            self.running = running
            await self._save()
        self.hub.publish({"type": "clock", **self._clock()})

    async def set_speed(self, speed: float) -> None:
        self._require_owner()
        async with self.lock:
            self.speed = speed
            await self._save()
        self.hub.publish({"type": "clock", **self._clock()})

    async def inject(self, scenario: str) -> str:
        engine = self._require_owner()
        async with self.lock:
            title = await engine.inject(scenario)
            await self._save()
        return title

    async def reset(self) -> None:
        """Удаляет всё сгенерированное и начинает симуляцию заново с текущего реального момента."""
        engine = self._require_owner()
        async with self.lock:
            await self.store.delete_generated(engine.started_at)
            fresh = PlantSimulator(self.store, self.hub)
            await fresh.init(None, datetime.now(TZ))
            self.engine = fresh
            await self._save()
        self.hub.publish({"type": "reload"})


runner = SimulatorRunner(hub)
