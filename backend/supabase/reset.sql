-- ВНИМАНИЕ: удаляет все таблицы проекта вместе с данными.
-- Использовать только при изменении схемы, затем заново выполнить migrations/*.sql и сидинг.

drop table if exists public.incidents          cascade;
drop table if exists public.downtime_events    cascade;
drop table if exists public.quality_records    cascade;
drop table if exists public.production_records cascade;
drop table if exists public.production_plans   cascade;
drop table if exists public.shifts             cascade;
drop table if exists public.equipment          cascade;
drop table if exists public.production_areas   cascade;
drop table if exists public.car_models         cascade;
drop table if exists public.factories          cascade;

notify pgrst, 'reload schema';
