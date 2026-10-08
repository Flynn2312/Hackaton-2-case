-- =====================================================================
-- Симулятор работы завода: состояние и аренда (lease) генератора
-- Выполнить в Supabase после 001_init_schema.sql: SQL Editor -> New query -> Run
-- =====================================================================

-- Одна строка (id = 1): кто сейчас генерирует данные, симуляционные часы и внутреннее состояние движка.
-- Аренда через heartbeat_at вместо advisory lock: пулер Supabase в transaction mode
-- не держит сессию, поэтому сессионные блокировки там не работают.
create table if not exists public.simulator_state (
    id            int         primary key default 1 check (id = 1),
    owner         text,                                   -- id инстанса бэкенда, который сейчас генерирует
    heartbeat_at  timestamptz,                            -- аренда истекает, если владелец молчит > 20 с
    running       boolean     not null default true,      -- пауза симуляции
    speed         real        not null default 60 check (speed > 0),  -- симуляционных секунд в реальной секунде
    sim_now       timestamptz,                            -- текущее симуляционное время
    started_at    timestamptz,                            -- с какого момента начаты сгенерированные данные
    state         jsonb       not null default '{}'::jsonb,
    updated_at    timestamptz not null default now()
);

insert into public.simulator_state (id) values (1) on conflict (id) do nothing;

alter table public.simulator_state enable row level security;
grant select, insert, update, delete on public.simulator_state to service_role;

notify pgrst, 'reload schema';
