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

1. Supabase Dashboard -> SQL Editor -> выполнить `supabase/migrations/001_init_schema.sql` (создаёт таблицы, связи, индексы).
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
  core/database.py   # клиент Supabase (dependency get_supabase)
  api/router.py      # сборка всех роутеров
  api/deps.py        # зависимости: БД, пагинация, 404
  api/routes/        # эндпоинты
  services/          # запросы к БД
  schemas/           # Pydantic-модели сущностей
scripts/seed.py      # генерация тестовых данных
supabase/            # SQL-миграции
```
