-- Monthly project progress: one row per project and month, so the portfolio shows a trend, not just today's status.
create table if not exists pmo_progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references pmo_projects(id) on delete cascade,
  fiscal_year text not null default '2026/27',
  month int not null check (month between 1 and 12),
  progress_pct numeric, spent numeric, rag text check (rag in ('Green','Amber','Red')), status text, note text,
  by_user uuid default auth.uid(), updated_at timestamptz default now(),
  unique (project_id, fiscal_year, month));
alter table pmo_progress enable row level security;
drop policy if exists pmo_progress_r on pmo_progress;
create policy pmo_progress_r on pmo_progress for select to authenticated using (public.has_position());
drop policy if exists pmo_progress_w on pmo_progress;
create policy pmo_progress_w on pmo_progress for all to authenticated
  using (public.is_group_admin() or exists(select 1 from positions p join org_units o on o.id = p.org_unit_id where p.user_id = auth.uid() and o.code = 'pmo')
         or public.can_plan_unit((select unit_id from pmo_projects x where x.id = project_id)))
  with check (public.is_group_admin() or exists(select 1 from positions p join org_units o on o.id = p.org_unit_id where p.user_id = auth.uid() and o.code = 'pmo')
         or public.can_plan_unit((select unit_id from pmo_projects x where x.id = project_id)));
grant select, insert, update, delete on pmo_progress to authenticated;
-- seed month 4 (Tikimt, the month this was added) from today's status so the trend starts now
insert into pmo_progress(project_id, month, progress_pct, spent, rag, status, note)
select id, 4, progress_pct, spent, case when rag in ('Green','Amber','Red') then rag end, status, note from pmo_projects
on conflict do nothing;
