-- =====================================================================
-- Варианты решения инцидентов: «ничего не менять», вариант A, вариант Б (генерирует ИИ)
-- Выполнить в Supabase после 002_simulator.sql: SQL Editor -> New query -> Run
-- =====================================================================

-- Одна строка на инцидент (id = id инцидента). Время (deadline_at, decided_at, created_at) — заводское,
-- из симуляции. Если оператор не выбрал до deadline_at, применяется «ничего не менять».
create table if not exists public.incident_decisions (
    id           bigint      primary key references public.incidents (id) on delete cascade,
    status       text        not null default 'generating'
                 check (status in ('generating', 'ready', 'applied', 'expired')),
    payload      jsonb,                       -- анализ, таблица показателей и аргументация вариантов
    recommended  text        check (recommended in ('none', 'A', 'B')),
    chosen       text        check (chosen in ('none', 'A', 'B')),
    decided_by   text        check (decided_by in ('operator', 'auto')),
    source       text,                        -- модель Claude или резервный алгоритм
    deadline_at  timestamptz,
    decided_at   timestamptz,
    created_at   timestamptz not null default now()
);

create index if not exists idx_incident_decisions_status  on public.incident_decisions (status);
create index if not exists idx_incident_decisions_created on public.incident_decisions (created_at);

alter table public.incident_decisions enable row level security;
grant select, insert, update, delete on public.incident_decisions to service_role;

-- Оператору нужно время на выбор: по умолчанию 1 секунда = 30 секунд завода
alter table public.simulator_state alter column speed set default 30;

notify pgrst, 'reload schema';
