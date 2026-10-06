# Backend — Цифровой двойник завода

FastAPI + Supabase.

## Запуск

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
cp .env.example .env            # заполнить SUPABASE_URL и SUPABASE_KEY
uvicorn app.main:app --reload
```

Swagger: http://localhost:8000/docs

## Проверка

- `GET /api/health` — сервер жив
- `GET /api/health/db` — есть соединение с Supabase (503, если нет)

## Структура

```
app/
  main.py            # создание приложения, CORS, роутеры
  core/config.py     # настройки из .env
  core/database.py   # клиент Supabase (dependency get_supabase)
  api/router.py      # сборка всех роутеров
  api/routes/        # эндпоинты
```
