-- =====================================================================
-- Цифровой двойник завода: начальная схема БД
-- Выполнить в Supabase: Dashboard -> SQL Editor -> New query -> Run
-- =====================================================================

-- ---------- Справочники ----------

create table if not exists public.factories (
    id          bigint generated always as identity primary key,
    name        text        not null,
    location    text,
    created_at  timestamptz not null default now()
);

create table if not exists public.car_models (
    id          bigint generated always as identity primary key,
    name        text        not null,
    code        text        not null unique,
    created_at  timestamptz not null default now()
);

create table if not exists public.production_areas (
    id          bigint generated always as identity primary key,
    factory_id  bigint not null references public.factories (id) on delete cascade,
    name        text   not null,
    code        text   not null,
    sequence    int    not null check (sequence > 0),
    unique (factory_id, code),
    unique (factory_id, sequence)
);

create table if not exists public.equipment (
    id                  bigint generated always as identity primary key,
    production_area_id  bigint not null references public.production_areas (id) on delete cascade,
    name                text   not null,
    code                text   not null unique,
    status              text   not null default 'running'
                        check (status in ('running', 'idle', 'maintenance', 'breakdown')),
    criticality         text   not null default 'medium'
                        check (criticality in ('low', 'medium', 'high'))
);

create table if not exists public.shifts (
    id          bigint generated always as identity primary key,
    factory_id  bigint      not null references public.factories (id) on delete cascade,
    name        text        not null,
    start_at    timestamptz not null,
    end_at      timestamptz not null,
    check (end_at > start_at),
    unique (factory_id, start_at)
);

-- ---------- Производство ----------

create table if not exists public.production_plans (
    id                bigint generated always as identity primary key,
    factory_id        bigint not null references public.factories (id) on delete cascade,
    shift_id          bigint not null references public.shifts (id) on delete cascade,
    car_model_id      bigint not null references public.car_models (id) on delete cascade,
    planned_quantity  int    not null check (planned_quantity >= 0),
    unique (shift_id, car_model_id)
);

create table if not exists public.production_records (
    id                  bigint generated always as identity primary key,
    shift_id            bigint        not null references public.shifts (id) on delete cascade,
    production_area_id  bigint        not null references public.production_areas (id) on delete cascade,
    car_model_id        bigint        not null references public.car_models (id) on delete cascade,
    timestamp           timestamptz   not null,
    planned_quantity    int           not null check (planned_quantity >= 0),
    actual_quantity     int           not null check (actual_quantity >= 0),
    runtime_minutes     int           not null check (runtime_minutes >= 0),
    load_percent        numeric(5, 2) not null check (load_percent between 0 and 100)
);

create table if not exists public.quality_records (
    id                  bigint generated always as identity primary key,
    shift_id            bigint      not null references public.shifts (id) on delete cascade,
    production_area_id  bigint      not null references public.production_areas (id) on delete cascade,
    car_model_id        bigint      not null references public.car_models (id) on delete cascade,
    timestamp           timestamptz not null,
    total_quantity      int         not null check (total_quantity >= 0),
    good_quantity       int         not null check (good_quantity >= 0),
    scrap_quantity      int         not null check (scrap_quantity >= 0),
    rework_quantity     int         not null check (rework_quantity >= 0),
    check (good_quantity + scrap_quantity + rework_quantity = total_quantity)
);

-- ---------- События ----------

create table if not exists public.downtime_events (
    id                bigint generated always as identity primary key,
    equipment_id      bigint      not null references public.equipment (id) on delete cascade,
    shift_id          bigint      references public.shifts (id) on delete set null,
    started_at        timestamptz not null,
    ended_at          timestamptz,                -- null = простой продолжается
    duration_minutes  int generated always as
                      ((extract(epoch from (ended_at - started_at)) / 60)::int) stored,
    reason            text        not null,
    type              text        not null
                      check (type in ('breakdown', 'planned_maintenance', 'material_shortage',
                                      'changeover', 'quality_issue', 'other')),
    check (ended_at is null or ended_at > started_at)
);

create table if not exists public.incidents (
    id                  bigint generated always as identity primary key,
    production_area_id  bigint      not null references public.production_areas (id) on delete cascade,
    equipment_id        bigint      references public.equipment (id) on delete set null,
    shift_id            bigint      references public.shifts (id) on delete set null,
    created_at          timestamptz not null default now(),
    severity            text        not null check (severity in ('low', 'medium', 'high', 'critical')),
    type                text        not null
                        check (type in ('equipment_failure', 'quality_deviation', 'plan_deviation',
                                        'downtime_limit', 'material_shortage', 'safety')),
    title               text        not null,
    description         text,
    status              text        not null default 'open'
                        check (status in ('open', 'in_progress', 'resolved', 'closed'))
);

-- ---------- Индексы ----------

create index if not exists idx_production_areas_factory   on public.production_areas (factory_id);
create index if not exists idx_equipment_area             on public.equipment (production_area_id);
create index if not exists idx_shifts_factory_start       on public.shifts (factory_id, start_at);
create index if not exists idx_production_plans_shift     on public.production_plans (shift_id);
create index if not exists idx_production_plans_model     on public.production_plans (car_model_id);
create index if not exists idx_production_records_shift   on public.production_records (shift_id);
create index if not exists idx_production_records_area_ts on public.production_records (production_area_id, timestamp);
create index if not exists idx_production_records_model   on public.production_records (car_model_id);
create index if not exists idx_quality_records_shift      on public.quality_records (shift_id);
create index if not exists idx_quality_records_area_ts    on public.quality_records (production_area_id, timestamp);
create index if not exists idx_quality_records_model      on public.quality_records (car_model_id);
create index if not exists idx_downtime_equipment_start   on public.downtime_events (equipment_id, started_at);
create index if not exists idx_downtime_shift             on public.downtime_events (shift_id);
create index if not exists idx_incidents_area_created     on public.incidents (production_area_id, created_at);
create index if not exists idx_incidents_equipment        on public.incidents (equipment_id);
create index if not exists idx_incidents_shift            on public.incidents (shift_id);
create index if not exists idx_incidents_status           on public.incidents (status);

-- ---------- Доступ ----------
-- RLS включён без политик: anon/authenticated ключи доступа не имеют,
-- бэкенд работает через service_role, который RLS обходит.

alter table public.factories          enable row level security;
alter table public.car_models         enable row level security;
alter table public.production_areas   enable row level security;
alter table public.equipment          enable row level security;
alter table public.shifts             enable row level security;
alter table public.production_plans   enable row level security;
alter table public.production_records enable row level security;
alter table public.quality_records    enable row level security;
alter table public.downtime_events    enable row level security;
alter table public.incidents          enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Обновить кэш схемы PostgREST, чтобы таблицы сразу стали доступны через API
notify pgrst, 'reload schema';
