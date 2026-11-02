-- audit works for tables without an id column (e.g. plan_status)
create or replace function public.audit() returns trigger language plpgsql security definer set search_path=public as $$
declare j jsonb := case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log(table_name,row_id,action,old_data,new_data,by_user)
  values (tg_table_name, coalesce(j->>'id', concat_ws('|', j->>'unit_id', j->>'plan_kind', j->>'period', j->>'key')), tg_op,
          case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end, auth.uid());
  return coalesce(new, old);
end $$;

-- OKR lifecycle: pause / drop with reason and evidence; share of own key results vs objectives below
alter table key_results add column if not exists state text not null default 'active' check (state in ('active','paused','dropped')),
  add column if not exists state_reason text, add column if not exists state_evidence text, add column if not exists state_at timestamptz,
  add column if not exists updater_position_id uuid references positions(id) on delete set null;
alter table objectives add column if not exists state text not null default 'active' check (state in ('active','paused','dropped')),
  add column if not exists state_reason text, add column if not exists own_weight numeric;
alter table objectives drop constraint if exists objectives_status_check;
alter table objectives add constraint objectives_status_check check (status in ('Draft','Submitted','Approved','Returned','Archived'));

-- deliverables can hang on an objective (when no key result fits) and carry their quarter and source
alter table deliverables add column if not exists objective_id uuid references objectives(id) on delete set null,
  add column if not exists quarter int, add column if not exists source text, add column if not exists note text;
-- weekly plan baseline (the plan as first set for the month)
alter table activities add column if not exists baseline_title text, add column if not exists baseline_week date, add column if not exists planned_by uuid references auth.users(id), add column if not exists locked boolean default false;

-- direct messages
create table if not exists messages(id uuid primary key default gen_random_uuid(), from_user uuid not null references auth.users(id) on delete cascade, to_user uuid not null references auth.users(id) on delete cascade, body text not null, link text, created_at timestamptz default now(), read_at timestamptz);
alter table messages enable row level security;
create policy messages_r on messages for select to authenticated using (from_user=auth.uid() or to_user=auth.uid());
create policy messages_i on messages for insert to authenticated with check (from_user=auth.uid() and public.has_position());
create policy messages_u on messages for update to authenticated using (to_user=auth.uid()) with check (to_user=auth.uid());

-- PMO project portfolio (from the weekly tracker)
create table if not exists pmo_projects(id uuid primary key default gen_random_uuid(), unit_id uuid references org_units(id) on delete set null, unit_code text, code text, name text not null, type text, directorate text, sponsor text, manager text,
  budget numeric, spent numeric, start_date date, end_date date, revised_end date, status text, rag text, progress_pct numeric, strategic_link text, unit_goal_id uuid references unit_goals(id) on delete set null, note text, updated_at timestamptz default now());
alter table pmo_projects enable row level security;
create policy pmo_r on pmo_projects for select to authenticated using (public.has_position());
create policy pmo_w on pmo_projects for all to authenticated using (public.is_group_admin() or exists(select 1 from positions p join org_units o on o.id=p.org_unit_id where p.user_id=auth.uid() and o.code='pmo')) with check (public.is_group_admin() or exists(select 1 from positions p join org_units o on o.id=p.org_unit_id where p.user_id=auth.uid() and o.code='pmo'));

-- actual cash from the tracker's bank positions (monthly) and weekly cash plan / actual
create table if not exists cash_actual(unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', month int, opening numeric, inflow numeric, outflow numeric, closing numeric, source text, primary key(unit_id, fiscal_year, month));
create table if not exists cash_weekly(unit_id uuid references org_units(id) on delete cascade, week_start date, direction text check (direction in ('in','out')), planned numeric, actual numeric, primary key(unit_id, week_start, direction));
alter table cash_actual enable row level security; alter table cash_weekly enable row level security;
create policy cash_actual_r on cash_actual for select to authenticated using (public.can_see_unit(unit_id));
create policy cash_actual_w on cash_actual for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));
create policy cash_weekly_r on cash_weekly for select to authenticated using (public.can_see_unit(unit_id));
create policy cash_weekly_w on cash_weekly for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));

-- monthly funds and payment scheduling for resources
create table if not exists fund_months(unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', month int, confirmed numeric default 0, expected numeric default 0, primary key(unit_id, fiscal_year, month));
create table if not exists need_schedule(id uuid primary key default gen_random_uuid(), unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', need_key text not null, plan_month int not null, pay_month int, amount numeric, rank int, status text default 'Scheduled' check (status in ('Scheduled','Deferred','Paid','Cancelled')), note text, unique(unit_id, fiscal_year, need_key, plan_month));
alter table fund_months enable row level security; alter table need_schedule enable row level security;
create policy fund_months_r on fund_months for select to authenticated using (public.can_see_unit(unit_id));
create policy fund_months_w on fund_months for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));
create policy need_schedule_r on need_schedule for select to authenticated using (public.can_see_unit(unit_id));
create policy need_schedule_w on need_schedule for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));

-- settings
insert into app_settings(key,value) values
 ('tax_rate','{"rate":30,"note":"Ethiopian corporate income tax"}'),
 ('modules','{"projects":{"label":"Project portfolio","owners":["pmo"],"view":"insights"},"weekly_cash":{"label":"Weekly cash flow","owners":["finance"],"view":"insights"}}'),
 ('framework_request','{}')
on conflict (key) do nothing;
-- PMO org unit (Group function) so the module has an owner
insert into org_units(code,name,kind,unit_type,parent_id,revenue_model,sort,pilot) select 'pmo','PMO','unit','function',(select id from org_units where kind='group'),'none',98,false where not exists(select 1 from org_units where code='pmo');
update org_units set unit_id=id where code='pmo' and unit_id is null;
do $$ declare t text; begin foreach t in array array['pmo_projects','need_schedule'] loop
  execute format('drop trigger if exists %I on public.%I', t||'_audit', t);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit()', t||'_audit', t); end loop; end $$;
