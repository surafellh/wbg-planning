-- Weekly planning by deliverable: an activity step can run over several weeks (one weekly row per week, same step_id).
alter table activities add column if not exists step_id uuid;
alter table activities add column if not exists step_order int;
alter table activities add column if not exists phase_id uuid;
alter table deliverables add column if not exists phase_id uuid;

-- Project phases: a phase runs from one month to another; each month of it becomes a monthly deliverable, and those break into weekly activities.
create table if not exists project_phases (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references org_units(id) on delete cascade,
  pmo_project_id uuid references pmo_projects(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  fiscal_year text not null default '2026/27',
  name text not null, start_month int not null check (start_month between 1 and 12), end_month int not null check (end_month between 1 and 12),
  owner_position_id uuid references positions(id) on delete set null,
  weight numeric, status text default 'Planned', note text, sort int default 0,
  created_at timestamptz default now(),
  check (pmo_project_id is not null or project_id is not null), check (end_month >= start_month));
alter table project_phases enable row level security;
drop policy if exists project_phases_r on project_phases;
create policy project_phases_r on project_phases for select to authenticated using (public.has_position());
drop policy if exists project_phases_w on project_phases;
create policy project_phases_w on project_phases for all to authenticated
  using (public.is_group_admin() or public.can_plan_unit(unit_id) or exists(select 1 from positions p join org_units o on o.id = p.org_unit_id where p.user_id = auth.uid() and o.code = 'pmo'))
  with check (public.is_group_admin() or public.can_plan_unit(unit_id) or exists(select 1 from positions p join org_units o on o.id = p.org_unit_id where p.user_id = auth.uid() and o.code = 'pmo'));
grant select, insert, update, delete on project_phases to authenticated;
alter table deliverables drop constraint if exists deliverables_phase_fk; alter table deliverables add constraint deliverables_phase_fk foreign key (phase_id) references project_phases(id) on delete set null;
alter table activities drop constraint if exists activities_phase_fk; alter table activities add constraint activities_phase_fk foreign key (phase_id) references project_phases(id) on delete set null;
