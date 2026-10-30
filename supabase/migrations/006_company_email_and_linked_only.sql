-- Admin signs in with the company email
update positions set email='surafel.h@wagwagoelectric.com' where id='8d01c8b1-bb2d-5e4b-a4a2-87ae04c65799';
-- Only people linked to a position can read anything (an unknown sign-up sees nothing)
create or replace function public.has_position() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from positions where user_id=auth.uid()) $$;
revoke execute on function public.has_position() from public, anon;
grant execute on function public.has_position() to authenticated;
do $$ declare t text; begin
 foreach t in array array['org_units','app_settings','group_pillars','group_goals'] loop
  execute format('drop policy if exists %I on public.%I', t||'_r', t);
  execute format('create policy %I on public.%I for select to authenticated using (public.has_position())', t||'_r', t);
 end loop; end $$;
drop policy if exists positions_r on positions;
create policy positions_r on positions for select to authenticated using (public.has_position() or user_id=auth.uid());
drop policy if exists profiles_r on profiles;
create policy profiles_r on profiles for select to authenticated using (public.has_position() or id=auth.uid());
drop policy if exists comments_r on comments;
create policy comments_r on comments for select to authenticated using (public.has_position());
drop policy if exists comments_i on comments;
create policy comments_i on comments for insert to authenticated with check (created_by=auth.uid() and public.has_position());
