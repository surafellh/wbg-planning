-- Weekly-tracker detail for activities and deliverables: reference codes, type, category, priority,
-- expected outcome, target / unit / actual, dependency, evidence, carry-over history, who updated.

create sequence if not exists activity_ref_seq;
create sequence if not exists deliverable_ref_seq;

alter table activities
  add column if not exists kind text default 'Task',             -- Task | Unplanned | Target-based | Phase step
  add column if not exists category text,                        -- Operational | Revenue | Strategic | Support (list in Studio)
  add column if not exists outcome text,                         -- expected outcome
  add column if not exists target numeric, add column if not exists uom text, add column if not exists actual numeric,
  add column if not exists lower_better boolean default false,
  add column if not exists weight numeric,                       -- share of the deliverable
  add column if not exists dependency text,                      -- what is needed from the unit it depends on
  add column if not exists evidence_url text,
  add column if not exists carried_count int default 0, add column if not exists carried_from uuid references activities(id) on delete set null,
  add column if not exists prev_status text, add column if not exists prev_pct numeric,
  add column if not exists updated_by uuid references auth.users(id);
alter table activities alter column code set default 'A-' || lpad(nextval('activity_ref_seq')::text, 5, '0');
update activities set code = 'A-' || lpad(nextval('activity_ref_seq')::text, 5, '0') where code is null;
-- statuses as in the tracker
alter table activities drop constraint if exists activities_status_check;
alter table activities add constraint activities_status_check check (status in ('Not started','In progress','Done','Stuck','Delayed','Closed'));

alter table deliverables
  add column if not exists code text default 'D-' || lpad(nextval('deliverable_ref_seq')::text, 5, '0'),
  add column if not exists kind text default 'Task-based',       -- Target-based | Phase-based | Task-based
  add column if not exists category text, add column if not exists priority int, add column if not exists outcome text;
update deliverables set code = 'D-' || lpad(nextval('deliverable_ref_seq')::text, 5, '0') where code is null;

-- who last updated an activity, and when it was completed
create or replace function public.touch_updated() returns trigger language plpgsql set search_path=public as $$
begin
  new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.status = 'Done' and (old.status is distinct from 'Done') then new.done_at := now(); end if;
  if new.status is distinct from 'Done' and old.status = 'Done' then new.done_at := null; end if;
  return new;
end $$;

insert into app_settings(key, value) values ('work_lists', '{"categories":["Operational","Revenue","Strategic","Support"],"priorities":["High","Medium","Low"]}')
on conflict (key) do nothing;
