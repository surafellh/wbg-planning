
create extension if not exists pgcrypto;

-- ============ organisation and people ============
create table org_units(
  id uuid primary key default gen_random_uuid(),
  code text unique, name text not null,
  kind text not null check (kind in ('group','unit','department','division')),
  unit_type text check (unit_type in ('business','function')),
  parent_id uuid references org_units(id) on delete cascade,
  unit_id uuid references org_units(id),            -- top unit (self for a unit)
  revenue_model text not null default 'none' check (revenue_model in ('product','project','none')),
  erp_name text, sort int default 0, active boolean default true, pilot boolean default false);
create index on org_units(parent_id); create index on org_units(unit_id);

create table profiles(id uuid primary key references auth.users(id) on delete cascade, email text, full_name text, created_at timestamptz default now());

create table positions(
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id) on delete cascade,
  unit_id uuid references org_units(id),
  title text not null,
  level text not null check (level in ('group','unit','department','division','employee')),
  role text not null check (role in ('super_admin','group_strategy','executive','unit_head','planning_head','finance','dept_head','div_head','employee')),
  holder_name text, hr_id text, erp_employee text,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'Filled' check (status in ('Filled','Vacant','Acting')),
  sort int default 0);
create index on positions(org_unit_id); create index on positions(unit_id);

create table app_settings(key text primary key, value jsonb not null);

-- ============ strategy ============
create table group_pillars(id uuid primary key default gen_random_uuid(), code text, name text not null, description text, sort int default 0);
create table group_goals(id uuid primary key default gen_random_uuid(), pillar_id uuid references group_pillars(id) on delete cascade, code text, name text not null, erp_goal_id int, weight numeric, sort int default 0);
create table unit_pillars(id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, code text, name text not null, description text, sort int default 0);
create table unit_goals(id uuid primary key default gen_random_uuid(), pillar_id uuid not null references unit_pillars(id) on delete cascade, unit_id uuid not null references org_units(id) on delete cascade, code text, name text not null, description text, group_goal_id uuid references group_goals(id), erp_goal_id int, weight numeric, link_confirmed boolean default false, sort int default 0);

-- ============ OKRs ============
create table objectives(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references org_units(id) on delete cascade,
  org_unit_id uuid not null references org_units(id) on delete cascade,
  fiscal_year text not null default '2026/27',
  level text not null check (level in ('unit','department','division')),
  unit_goal_id uuid references unit_goals(id) on delete set null,
  parent_objective_id uuid references objectives(id) on delete set null,
  parent_kr_id uuid,
  text text not null, weight_to_parent numeric,
  owner_position_id uuid references positions(id) on delete set null,
  status text not null default 'Draft' check (status in ('Draft','Submitted','Approved','Returned')),
  erp_okr_id int, sort int default 0, created_at timestamptz default now(),
  constraint goal_or_parent check (not (unit_goal_id is not null and (parent_objective_id is not null or parent_kr_id is not null))));
create index on objectives(unit_id); create index on objectives(org_unit_id);

create table key_results(
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  title text not null, uom text,
  kr_type text not null default 'cumulative' check (kr_type in ('cumulative','level','milestone')),
  lower_is_better boolean default false,
  weight numeric,
  owner_position_id uuid references positions(id) on delete set null,
  measure text not null default 'manual' check (measure in ('plan','deliverables','children','manual')),
  baseline numeric, year_target numeric, confidence text default 'Medium',
  retired_at date, erp_kr_text text, sort int default 0);
alter table objectives add constraint objectives_parent_kr_fk foreign key (parent_kr_id) references key_results(id) on delete set null;
create index on key_results(objective_id);

create table kr_targets(kr_id uuid references key_results(id) on delete cascade, quarter int check (quarter between 1 and 4), target numeric, primary key(kr_id, quarter));
create table kr_plan_links(kr_id uuid primary key references key_results(id) on delete cascade, section text not null check (section in ('rev','cos','opex','capex','proj')), metric text not null check (metric in ('value','quantity')), line_groups text[]);
create table check_ins(id uuid primary key default gen_random_uuid(), kr_id uuid not null references key_results(id) on delete cascade, fiscal_year text default '2026/27', quarter int, value numeric, confidence text, note text, evidence_url text, created_by uuid references auth.users(id), created_at timestamptz default now(), sample boolean default false);
create index on check_ins(kr_id);

-- ============ annual plan ============
create table projects(
  id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text default '2026/27',
  code text, name text not null, client text, service_line text, contract_value numeric, start_date date, end_date date,
  phase text, progress_pct numeric, status text default 'Active', note text, sort int default 0);

create table plan_lines(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text not null default '2026/27',
  section text not null check (section in ('rev','cos','opex','capex','proj')),
  line_group text, code text, name text not null, uom text,
  kind text not null check (kind in ('qty','value')),
  qty0 numeric[], qty numeric[], price0 numeric[], price numeric[], val0 numeric[], val numeric[],
  tier text default 'Funded' check (tier in ('Funded','Conditional','Backlog')),
  must_pay boolean default false, noncash boolean default false,
  key_result_id uuid references key_results(id) on delete set null,
  follows_line_id uuid references plan_lines(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  note text, sort int default 0);
create index on plan_lines(unit_id, fiscal_year, section);

create table actuals(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text not null default '2026/27',
  section text not null, line_group text not null, line_id uuid references plan_lines(id) on delete cascade,
  month int not null check (month between 1 and 12), value numeric, qty numeric,
  source text, loaded_at timestamptz default now());
create unique index actuals_uq on actuals(unit_id, fiscal_year, section, line_group, coalesce(line_id,'00000000-0000-0000-0000-000000000000'::uuid), month);

create table cash_items(id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text default '2026/27', item text not null, direction text not null check (direction in ('in','out','opening')), sort int default 0);
create table cash_values(item_id uuid references cash_items(id) on delete cascade, month int check (month between 1 and 12), plan numeric, actual numeric, primary key(item_id, month));

create table activity_plan_lines(
  id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text default '2026/27',
  code text, name text not null, department text, uom text, target_logic text, monthly numeric[], monthly_text text[], annual_target numeric, budget numeric,
  key_result_id uuid references key_results(id) on delete set null, source text, sort int default 0);

create table funds(unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', quarter int, confirmed numeric default 0, expected numeric default 0, primary key(unit_id, fiscal_year, quarter));
create table need_priority(unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', need_key text, rank int, primary key(unit_id, fiscal_year, need_key));

-- ============ execution ============
create table deliverables(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references org_units(id) on delete cascade,
  key_result_id uuid references key_results(id) on delete set null,
  owner_position_id uuid references positions(id) on delete set null,
  fiscal_year text default '2026/27', month int check (month between 1 and 12),
  title text not null, target numeric, uom text, actual numeric, weight numeric,
  status text not null default 'planned' check (status in ('planned','done','accepted','returned','removed','transferred')),
  quality text, evidence_url text, carried_from uuid, sample boolean default false,
  created_by uuid references auth.users(id), created_at timestamptz default now());
create index on deliverables(unit_id, month); create index on deliverables(key_result_id);

create table activities(
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references org_units(id) on delete cascade,
  deliverable_id uuid references deliverables(id) on delete set null,
  owner_position_id uuid references positions(id) on delete set null,
  week_start date not null, code text, title text not null,
  status text not null default 'Not started' check (status in ('Not started','In progress','Done','Stuck','Closed')),
  pct numeric default 0, priority int default 0, top boolean default false, unplanned boolean default false, note text, due_date date,
  sample boolean default false, created_by uuid references auth.users(id), created_at timestamptz default now());
create index on activities(unit_id, week_start);

create table plan_status(unit_id uuid references org_units(id) on delete cascade, fiscal_year text default '2026/27', plan_kind text check (plan_kind in ('okr','annual','quarter','month','week','resources')), period text default '', status text not null, note text, by_user uuid references auth.users(id), at timestamptz default now(), primary key(unit_id, fiscal_year, plan_kind, period));

create table rescopes(id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, fiscal_year text default '2026/27', trigger text, kind text default 'rescope', status text not null default 'Submitted', note text, changes jsonb, before_snapshot jsonb, by_user uuid references auth.users(id), at timestamptz default now(), decided_by uuid references auth.users(id), decided_at timestamptz);

-- ============ performance ============
create table scorecards(id uuid primary key default gen_random_uuid(), position_id uuid not null references positions(id) on delete cascade, fiscal_year text default '2026/27', quarter int, status text not null default 'Draft' check (status in ('Draft','Proposed','Agreed','Discuss')), note text, prepared_by uuid references auth.users(id), at timestamptz default now(), unique(position_id, fiscal_year, quarter));
create table scorecard_items(id uuid primary key default gen_random_uuid(), scorecard_id uuid not null references scorecards(id) on delete cascade, item_type text check (item_type in ('deliverable','kr')), item_id uuid not null, weight numeric);

create table kpis(id uuid primary key default gen_random_uuid(), unit_id uuid not null references org_units(id) on delete cascade, name text not null, uom text, target numeric, warn numeric, lower_is_better boolean default false, source text, sort int default 0);
create table kpi_values(kpi_id uuid references kpis(id) on delete cascade, fiscal_year text default '2026/27', month int, value numeric, primary key(kpi_id, fiscal_year, month));

-- ============ shared services ============
create table comments(id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id uuid not null, body text not null, created_by uuid references auth.users(id), created_at timestamptz default now());
create index on comments(entity_type, entity_id);
create table notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, kind text, title text not null, body text, link text, read_at timestamptz, created_at timestamptz default now());
create index on notifications(user_id, created_at desc);
create table audit_log(id bigserial primary key, table_name text, row_id text, action text, old_data jsonb, new_data jsonb, by_user uuid, at timestamptz default now());
create table import_log(id bigserial primary key, source text, rows_read int, rows_created int, rows_rejected int, note text, at timestamptz default now());
