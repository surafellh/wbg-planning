-- Key results: how progress is calculated and how targets are entered
alter table key_results add column if not exists aggregation text not null default 'sum' check (aggregation in ('sum','average','latest','max','min'));
alter table key_results add column if not exists direction text not null default 'increase' check (direction in ('increase','decrease','maintain'));
alter table key_results add column if not exists target_mode text not null default 'annual' check (target_mode in ('annual','quarterly','monthly'));
alter table key_results add column if not exists tolerance numeric;
update key_results set aggregation = case kr_type when 'cumulative' then 'sum' else 'latest' end, direction = case when lower_is_better then 'decrease' else 'increase' end;
update key_results k set target_mode='quarterly' where exists(select 1 from kr_targets t where t.kr_id=k.id);
create table if not exists kr_month_targets(kr_id uuid references key_results(id) on delete cascade, month int check (month between 1 and 12), target numeric, primary key(kr_id, month));
alter table kr_month_targets enable row level security;
create policy kr_month_targets_r on kr_month_targets for select to authenticated using (public.can_see_unit(public.unit_of_kr(kr_id)));
create policy kr_month_targets_w on kr_month_targets for all to authenticated using (public.can_plan_unit(public.unit_of_kr(kr_id))) with check (public.can_plan_unit(public.unit_of_kr(kr_id)));
alter table check_ins add column if not exists month int check (month between 1 and 12);
update check_ins set month = quarter*3 where month is null and quarter is not null;

-- Strategy identity (vision, mission, values) for the Group and each unit
create table if not exists strategy_statements(
  unit_id uuid primary key references org_units(id) on delete cascade, period text, vision text, mission text,
  values jsonb, intent text, updated_at timestamptz default now());
alter table strategy_statements enable row level security;
create policy strategy_statements_r on strategy_statements for select to authenticated using (public.has_position());
create policy strategy_statements_w on strategy_statements for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));
alter table group_pillars add column if not exists outcomes text;
alter table unit_pillars add column if not exists outcomes text;
alter table group_goals add column if not exists description text;

-- Work: activities link to key results, carry blockers; weekly reviews; richer deliverables
alter table activities add column if not exists key_result_id uuid references key_results(id) on delete set null;
alter table activities add column if not exists blocker text;
alter table activities add column if not exists help_from_unit uuid references org_units(id) on delete set null;
alter table activities add column if not exists done_at timestamptz;
alter table activities add column if not exists updated_at timestamptz default now();
alter table deliverables add column if not exists due_date date;
alter table deliverables add column if not exists rating int check (rating between 1 and 5);
alter table deliverables add column if not exists feedback text;
alter table deliverables add column if not exists done_at timestamptz;
alter table deliverables add column if not exists accepted_at timestamptz;
create table if not exists week_reviews(
  id uuid primary key default gen_random_uuid(), position_id uuid not null references positions(id) on delete cascade, unit_id uuid references org_units(id) on delete cascade,
  week_start date not null, wins text, blockers text, asks text, submitted_at timestamptz,
  feedback text, feedback_by uuid references auth.users(id), feedback_at timestamptz, rating int check (rating between 1 and 5),
  unique(position_id, week_start));
alter table week_reviews enable row level security;
create policy week_reviews_r on week_reviews for select to authenticated using (public.can_see_unit(unit_id) or public.is_my_position(position_id));
create policy week_reviews_w on week_reviews for all to authenticated using (public.is_my_position(position_id) or public.can_plan_unit(unit_id)) with check (public.is_my_position(position_id) or public.can_plan_unit(unit_id));

-- touch updated_at on activities
create or replace function public.touch_updated() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at := now(); if new.status='Done' and (old.status is distinct from 'Done') then new.done_at := now(); end if; return new; end $$;
drop trigger if exists activities_touch on activities;
create trigger activities_touch before update on activities for each row execute function public.touch_updated();

insert into app_settings(key,value) values ('status_method','{"method":"pace","grace_pct":15,"low_confidence":"behind"}') on conflict (key) do nothing;