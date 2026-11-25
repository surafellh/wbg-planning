-- 020: Demo / Live spaces inside one database.
-- Every working table gets a `space` ('demo' | 'live'). The browser sends the header `x-space`; rows are read and written
-- only in that space (restrictive RLS + column default). Without the header the space is 'demo', so the app that was
-- running before this change keeps seeing exactly what it saw. People, organisation units, positions, settings and the
-- group strategy (pillars, goals) are shared by both spaces.

create or replace function public.current_space() returns text language sql stable as $$
  select case when coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-space', '') = 'live' then 'live' else 'demo' end
$$;
grant execute on function public.current_space() to anon, authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'objectives','key_results','kr_targets','kr_plan_links','kr_month_targets','check_ins','unit_pillars','unit_goals',
    'projects','plan_lines','actuals','cash_items','cash_values','activity_plan_lines','funds','need_priority','plan_status',
    'rescopes','deliverables','activities','scorecards','scorecard_items','kpis','kpi_values','comments','notifications',
    'messages','week_reviews','pmo_projects','cash_actual','cash_weekly','fund_months','need_schedule','need_plan',
    'pmo_progress','project_phases','deliverable_files','audit_log'
  ] loop
    execute format('alter table public.%I add column if not exists space text not null default ''demo''', t);
    execute format('alter table public.%I alter column space set default public.current_space()', t);
    execute format('alter table public.%I add constraint %I check (space in (''demo'',''live''))', t, t || '_space_chk');
    execute format('drop policy if exists space_match on public.%I', t);
    execute format('create policy space_match on public.%I as restrictive for all using (space = public.current_space()) with check (space = public.current_space())', t);
    execute format('create index if not exists %I on public.%I (space)', t || '_space_idx', t);
  end loop;
end $$;

-- natural keys must not collide between the two spaces
alter table public.cash_actual drop constraint cash_actual_pkey, add primary key (unit_id, fiscal_year, month, space);
alter table public.cash_weekly drop constraint cash_weekly_pkey, add primary key (unit_id, week_start, direction, space);
alter table public.fund_months drop constraint fund_months_pkey, add primary key (unit_id, fiscal_year, month, space);
alter table public.funds drop constraint funds_pkey, add primary key (unit_id, fiscal_year, quarter, space);
alter table public.need_plan drop constraint need_plan_pkey, add primary key (unit_id, fiscal_year, quarter, need_key, space);
alter table public.need_priority drop constraint need_priority_pkey, add primary key (unit_id, fiscal_year, need_key, space);
alter table public.plan_status drop constraint plan_status_pkey, add primary key (unit_id, fiscal_year, plan_kind, period, space);
alter table public.need_schedule drop constraint need_schedule_unit_id_fiscal_year_need_key_plan_month_key, add unique (unit_id, fiscal_year, need_key, plan_month, space);
alter table public.scorecards drop constraint scorecards_position_id_fiscal_year_quarter_key, add unique (position_id, fiscal_year, quarter, space);
alter table public.week_reviews drop constraint week_reviews_position_id_week_start_key, add unique (position_id, week_start, space);
drop index if exists public.actuals_uq;
create unique index actuals_uq on public.actuals (unit_id, fiscal_year, section, line_group, coalesce(line_id, '00000000-0000-0000-0000-000000000000'::uuid), month, space);

-- ERP OKR library: the OKRs loaded from the ERP, kept read-only. A unit adopts one into Live when it chooses to plan with it.
alter table public.objectives add column if not exists library_id uuid;
alter table public.key_results add column if not exists library_id uuid;
create table if not exists public.okr_library (
  id uuid primary key,                       -- the objective's id when the library was taken
  unit_id uuid, org_unit_id uuid, fiscal_year text, level text,
  parent_objective_id uuid, parent_kr_id uuid, text text, weight_to_parent numeric, owner_position_id uuid,
  erp_okr_id integer, sort integer, own_weight numeric,
  krs jsonb not null default '[]'
);
alter table public.okr_library enable row level security;
drop policy if exists okr_library_r on public.okr_library;
create policy okr_library_r on public.okr_library for select to authenticated using (public.can_see_unit(unit_id));

insert into public.okr_library (id, unit_id, org_unit_id, fiscal_year, level, parent_objective_id, parent_kr_id, text, weight_to_parent, owner_position_id, erp_okr_id, sort, own_weight, krs)
select o.id, o.unit_id, o.org_unit_id, o.fiscal_year, o.level, o.parent_objective_id, o.parent_kr_id, o.text, o.weight_to_parent, o.owner_position_id, o.erp_okr_id, o.sort, o.own_weight,
  coalesce((select jsonb_agg(to_jsonb(k) - 'space' - 'library_id' order by k.sort) from public.key_results k where k.objective_id = o.id and k.retired_at is null), '[]')
from public.objectives o where o.space = 'demo' and o.status <> 'Archived'
on conflict (id) do nothing;

-- Adopt an ERP OKR into Live: copies the objective and its key results (runs with the caller's rights, so normal edit rules apply).
create or replace function public.adopt_okr(lib uuid) returns uuid language plpgsql as $$
declare l public.okr_library; nid uuid; k jsonb; pid uuid; pk uuid;
begin
  select * into l from public.okr_library where id = lib;
  if not found then raise exception 'ERP OKR not found'; end if;
  select id into nid from public.objectives where library_id = lib and status <> 'Archived' limit 1;
  if nid is not null then return nid; end if;
  select id into pid from public.objectives where library_id = l.parent_objective_id and status <> 'Archived' limit 1;
  select id into pk from public.key_results where library_id = l.parent_kr_id limit 1;
  insert into public.objectives (unit_id, org_unit_id, fiscal_year, level, parent_objective_id, parent_kr_id, text, weight_to_parent, owner_position_id, status, erp_okr_id, sort, origin, own_weight, library_id)
  values (l.unit_id, l.org_unit_id, l.fiscal_year, l.level, pid, pk, l.text, l.weight_to_parent, l.owner_position_id, 'Draft', l.erp_okr_id, l.sort, 'erp', l.own_weight, lib)
  returning id into nid;
  for k in select * from jsonb_array_elements(l.krs) loop
    insert into public.key_results (objective_id, title, uom, kr_type, lower_is_better, weight, owner_position_id, measure, baseline, year_target, confidence, erp_kr_text, sort, aggregation, direction, target_mode, tolerance, state, library_id)
    values (nid, k->>'title', k->>'uom', k->>'kr_type', coalesce((k->>'lower_is_better')::boolean, false), (k->>'weight')::numeric, (k->>'owner_position_id')::uuid, k->>'measure', (k->>'baseline')::numeric, (k->>'year_target')::numeric,
      k->>'confidence', k->>'erp_kr_text', (k->>'sort')::int, k->>'aggregation', k->>'direction', k->>'target_mode', (k->>'tolerance')::numeric, coalesce(k->>'state', 'active'), (k->>'id')::uuid);
  end loop;
  return nid;
end $$;
grant execute on function public.adopt_okr(uuid) to authenticated;
