# Backend — Цифровой двойник завода

FastAPI + Supabase.

## Запуск

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env            # заполнить SUPABASE_URL и SUPABASE_SECRET_KEY
uvicorn app.main:app --reload
```

Swagger: http://localhost:8000/docs

## База данных

1. Supabase Dashboard -> SQL Editor -> выполнить по порядку `supabase/migrations/001_init_schema.sql` (таблицы, связи, индексы)
   и `002_simulator.sql` (состояние симулятора).
2. Залить тестовые данные (повторный запуск пересоздаёт их):
   ```bash
   python -m scripts.seed
   ```
3. Если схема поменялась: выполнить `supabase/reset.sql`, затем снова шаги 1–2.

Таблицы: `factories`, `car_models`, `production_areas`, `equipment`, `shifts`, `production_plans`,
`production_records` (почасовая выработка по участкам), `quality_records`, `downtime_events`, `incidents`.

Тестовые данные: 01.07–05.10.2026, рабочие дни, 2 смены по 8 ч, поток Сварка -> Окраска -> Сборка -> ОТК.
Строки из файла с тестовыми данными кейса (01–02.10) воспроизведены точно. Заложены сценарии для аналитики:
Окраска — узкое место с браком выше 2%, рост простоев Конвейера-03 перед обрывом цепи 02.10,
деградация Камеры-02 (рост засоров и брака к октябрю), текущий незакрытый простой AGV-02.

## Симулятор завода (живые данные)

При старте API запускается фоновый генератор (`app/simulator/`), который имитирует работу завода и пишет в БД:
смены и планы, почасовую выработку и качество (дописываются по ходу часа), простои оборудования со сменой его статуса,
инциденты по правилам кейса и их жизненный цикл `open -> in_progress -> resolved -> closed`.

- Темп 1:60 — секунда реального времени = минута заводского. Ночи и выходные пропускаются.
- Старт — с текущей даты; дальше симуляционные часы идут непрерывно и переживают перезапуски
  (состояние движка лежит в `simulator_state`).
- Оборудование изнашивается: учащаются короткие остановки-предвестники, при 100% износа — тяжёлый отказ,
  плановое ТО износ сбрасывает. Это материал для AI Risk Center.
- Генерирует только один инстанс (аренда в `simulator_state`, heartbeat раз в 3 с). Если владелец пропал
  (деплой, сон Render), другой инстанс подхватывает генерацию примерно через 20 с.
- Локально, чтобы не перехватывать генерацию у задеплоенного бэкенда, задайте в `.env` `SIMULATOR_ENABLED=false`.
- Модель завода общая с сидом — `app/simulator/plant.py`.

| Эндпоинт | Назначение |
|---|---|
| `GET /api/sim/status` | время завода, скорость, пауза, список сценариев |
| `POST /api/sim/pause`, `/api/sim/resume` | пауза / продолжение |
| `POST /api/sim/speed` `{"speed": 60}` | скорость (симуляционных секунд в секунду) |
| `POST /api/sim/inject` `{"scenario": "conveyor_break"}` | вызвать событие: `conveyor_break`, `paint_defects`, `weld_robot`, `material_shortage`, `safety` |
| `POST /api/sim/reset` | удалить сгенерированные данные и начать заново с текущей даты |
| `GET /api/digital-twin/live-status` | статусы оборудования, идущие простои, открытые инциденты |
| `WS /ws/digital-twin/stream` | поток событий: `clock`, `upsert` (изменённые строки таблиц), `notice`, `reload` |

Фронт подписывается на WebSocket, дописывает пришедшие строки в загруженные данные и пересчитывает дашборд без перезагрузки.

## Проверка

- `GET /api/health` — сервер жив
- `GET /api/health/db` — есть соединение с Supabase (503, если нет)

## Эндпоинты (чтение)

Все под префиксом `/api`, подробности и фильтры — в Swagger.

| Эндпоинт | Фильтры |
|---|---|
| `/factories`, `/factories/{id}` | — |
| `/car-models`, `/car-models/{id}` | — |
| `/production-areas`, `/production-areas/{id}` | `factory_id` |
| `/equipment`, `/equipment/{id}` | `production_area_id`, `status`, `criticality` |
| `/shifts`, `/shifts/{id}` | `factory_id`, `date_from`, `date_to` |
| `/production-plans` | `factory_id`, `shift_id`, `car_model_id` |
| `/production-records` | `shift_id`, `production_area_id`, `car_model_id`, `date_from`, `date_to` |
| `/quality-records` | `shift_id`, `production_area_id`, `car_model_id`, `date_from`, `date_to` |
| `/downtime-events`, `/downtime-events/{id}` | `equipment_id`, `shift_id`, `type`, `active`, `date_from`, `date_to` |
| `/incidents`, `/incidents/{id}` | `production_area_id`, `equipment_id`, `shift_id`, `status`, `severity`, `type`, `date_from`, `date_to` |

Списки событий, смен и записей возвращаются от новых к старым, с пагинацией `limit` (по умолчанию 100, максимум 1000) и `offset`.
Период — `[date_from, date_to)`, в ISO 8601 с часовым поясом, например `2026-10-01T08:00:00+05:00` (в URL `+` кодируется как `%2B`).

## Структура

```
app/
  main.py            # создание приложения, CORS, роутеры
  core/config.py     # настройки из .env
  core/database.py   # пул asyncpg (get_db) и клиент Supabase (get_supabase)
  api/*.py           # эндпоинты /api/* (данные из БД через repositories/)
  api/routes/        # AI-движок и сценарная аналитика кейса (Copilot, What-If, ROI)
  repositories/      # SQL-запросы к БД
  services/          # AI-движок, аналитика, данные кейса
  simulator/         # симулятор завода: модель, движок, запуск, WebSocket-хаб
  schemas/           # Pydantic-модели AI и аналитики
scripts/seed.py      # генерация тестовых данных
supabase/            # SQL-миграции
```
