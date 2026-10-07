import logging
from typing import AsyncGenerator

import asyncpg
from asyncpg.pool import Pool
from app.core.config import get_settings

MIN_CON_SIZE = 2
MAX_CON_SIZE = 10

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Менеджер для управления пулом соединений"""

    def __init__(self):
        self.pool: Pool | None = None

    async def connect(self):
        """Создает пул соединений при старте приложения"""
        try:
            settings = get_settings()
            self.pool = await asyncpg.create_pool(
                dsn=settings.database_url,
                min_size=MIN_CON_SIZE,
                max_size=MAX_CON_SIZE,
                command_timeout=30.0,
                # Supabase pooler (pgbouncer, transaction mode) не поддерживает prepared statements
                statement_cache_size=0
            )
            logger.info("Подключение к БД успешно установлено (пул создан: min=%d, max=%d)", MIN_CON_SIZE, MAX_CON_SIZE)
        except Exception as e:
            logger.error("Ошибка при создании пула соединений с БД: %s", e)
            raise

    async def disconnect(self):
        """Закрывает пул соединений при остановке приложения"""
        if self.pool:
            try:
                await self.pool.close()
                logger.info("Соединения с БД успешно закрыты")
            except Exception as e:
                logger.error("Ошибка при закрытии пула соединений с БД: %s", e)
                raise
        else:
            logger.warning("Попытка закрыть неинициализированный пул соединений с БД")


db_manager = DatabaseManager()


async def get_db() -> AsyncGenerator[asyncpg.Connection, None]:
    """Выдает соединение из пула для конкретного эндпоинта и возвращает обратно после ответа."""
    if db_manager.pool is None:
        logger.error("Попытка получить соединение из неинициализированного пула БД")
        raise RuntimeError("Пул соединений с БД не инициализирован")

    async with db_manager.pool.acquire() as connection:
        logger.debug("Соединение с БД успешно получено из пула")
        try:
            yield connection
        finally:
            logger.debug("Соединение с БД возвращено в пул")
