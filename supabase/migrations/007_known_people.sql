-- Weekly-tracker users (email, name, role, unit) used to pre-link positions by email.
-- Rows were copied from the tracker project and are not stored in this repository.
create extension if not exists pg_trgm;
create table if not exists known_people(email text primary key, full_name text, tracker_role text, unit_code text, department text, matched_position uuid references positions(id) on delete set null, note text);
alter table known_people enable row level security;
create policy known_people_r on known_people for select to authenticated using (public.is_group_admin());
create policy known_people_w on known_people for all to authenticated using (public.is_group_admin()) with check (public.is_group_admin());
