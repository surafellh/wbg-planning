-- Evidence files on deliverables: private bucket, at most 3 files and 5 MB per deliverable, 15 MB per person per week.
insert into storage.buckets (id, name, public, file_size_limit) values ('evidence', 'evidence', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

create table if not exists deliverable_files (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  owner_position_id uuid references positions(id) on delete set null,
  path text not null unique, name text not null, size bigint not null, mime text,
  by_user uuid default auth.uid(), created_at timestamptz default now());
alter table deliverable_files enable row level security;
drop policy if exists deliverable_files_r on deliverable_files;
create policy deliverable_files_r on deliverable_files for select to authenticated using (public.has_position());
drop policy if exists deliverable_files_i on deliverable_files;
create policy deliverable_files_i on deliverable_files for insert to authenticated with check (public.has_position() and by_user = auth.uid());
drop policy if exists deliverable_files_d on deliverable_files;
create policy deliverable_files_d on deliverable_files for delete to authenticated using (by_user = auth.uid() or public.is_group_admin());
grant select, insert, delete on deliverable_files to authenticated;

create or replace function public.check_deliverable_files() returns trigger language plpgsql security definer set search_path=public as $$
declare n int; tot bigint; wk bigint; ws date := date_trunc('week', now() + interval '2 days')::date - 2; -- weeks start on Saturday
begin
  select count(*), coalesce(sum(size),0) into n, tot from deliverable_files where deliverable_id = new.deliverable_id;
  if n >= 3 then raise exception 'At most 3 files per deliverable'; end if;
  if tot + new.size > 5242880 then raise exception 'Files on one deliverable can total at most 5 MB'; end if;
  select coalesce(sum(size),0) into wk from deliverable_files where by_user = new.by_user and created_at >= ws;
  if wk + new.size > 15728640 then raise exception 'At most 15 MB of files per person per week'; end if;
  return new;
end $$;
drop trigger if exists deliverable_files_limits on deliverable_files;
create trigger deliverable_files_limits before insert on deliverable_files for each row execute function public.check_deliverable_files();

drop policy if exists evidence_r on storage.objects;
create policy evidence_r on storage.objects for select to authenticated using (bucket_id = 'evidence' and public.has_position());
drop policy if exists evidence_i on storage.objects;
create policy evidence_i on storage.objects for insert to authenticated with check (bucket_id = 'evidence' and public.has_position());
drop policy if exists evidence_d on storage.objects;
create policy evidence_d on storage.objects for delete to authenticated using (bucket_id = 'evidence' and (owner = auth.uid() or public.is_group_admin()));

-- Project phases: dependency and planned vs actual finish dates.
alter table project_phases add column if not exists depends_on uuid references project_phases(id) on delete set null;
alter table project_phases add column if not exists planned_finish date;
alter table project_phases add column if not exists actual_finish date;
