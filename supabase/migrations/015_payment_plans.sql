-- Payment plan per budget line and quarter: when the line is paid and how (as planned, monthly recurring, one payment, two payments).
create table if not exists public.need_plan (
  unit_id uuid not null references org_units(id) on delete cascade,
  fiscal_year text not null default '2026/27',
  quarter int not null check (quarter between 1 and 4),
  need_key text not null,                 -- section|group|line id
  pattern text not null default 'planned' check (pattern in ('planned','monthly','once','twice')),
  months int[] not null default '{}',     -- fiscal months paid in (1..12)
  amounts numeric[] not null default '{}',-- amount paid in each of those months
  note text,
  updated_at timestamptz default now(),
  primary key (unit_id, fiscal_year, quarter, need_key)
);
alter table public.need_plan enable row level security;
drop policy if exists need_plan_r on public.need_plan; create policy need_plan_r on public.need_plan for select to authenticated using (public.can_see_unit(unit_id));
drop policy if exists need_plan_w on public.need_plan; create policy need_plan_w on public.need_plan for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id));
grant select, insert, update, delete on public.need_plan to authenticated;
