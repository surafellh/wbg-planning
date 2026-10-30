
insert into app_settings(key,value) values
 ('org_weights','{"unit":70,"department":60,"division":50,"employee":30}'),
 ('hr_scale','{"max":70}'),
 ('status_thresholds','{"on_track":95,"off_track":70}'),
 ('bands','[{"name":"Achieved","min":100},{"name":"Well performed","min":75},{"name":"Partially achieved","min":40},{"name":"Under performed","min":0}]'),
 ('calendar','{"fy_start_month":7,"fy_start_day":8,"week_start":"saturday","weekly_cutoff":"Sat 14:00","monthly_close_day":9}'),
 ('current','{"fiscal_year":"2026/27","quarter":2}')
on conflict (key) do nothing;

-- ---------- access helpers (security definer, fixed search_path) ----------
create or replace function public.my_roles() returns text[] language sql stable security definer set search_path=public as
$$ select coalesce(array_agg(distinct role),'{}') from positions where user_id=auth.uid() $$;

create or replace function public.is_group_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from positions where user_id=auth.uid() and role in ('super_admin','group_strategy')) $$;

create or replace function public.sees_all() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from positions where user_id=auth.uid() and role in ('super_admin','group_strategy','executive')) $$;

create or replace function public.can_see_unit(u uuid) returns boolean language sql stable security definer set search_path=public as
$$ select public.sees_all() or exists(select 1 from positions where user_id=auth.uid() and unit_id=u) $$;

create or replace function public.can_plan_unit(u uuid) returns boolean language sql stable security definer set search_path=public as
$$ select public.is_group_admin() or exists(select 1 from positions where user_id=auth.uid() and unit_id=u and role in ('unit_head','planning_head','finance','dept_head','div_head')) $$;

create or replace function public.is_my_position(p uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from positions where id=p and user_id=auth.uid()) $$;

-- unit of an objective / key result (for child tables)
create or replace function public.unit_of_obj(o uuid) returns uuid language sql stable security definer set search_path=public as $$ select unit_id from objectives where id=o $$;
create or replace function public.unit_of_kr(kid uuid) returns uuid language sql stable security definer set search_path=public as $$ select o.unit_id from key_results kr join objectives o on o.id=kr.objective_id where kr.id=kid $$;

-- ---------- enable RLS everywhere ----------
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='public' loop
   execute format('alter table public.%I enable row level security',t);
 end loop; end $$;

-- reference data: everyone signed in reads, group admins write
do $$ declare t text; begin
 foreach t in array array['org_units','app_settings','group_pillars','group_goals'] loop
  execute format('create policy %I on public.%I for select to authenticated using (true)',t||'_r',t);
  execute format('create policy %I on public.%I for all to authenticated using (public.is_group_admin()) with check (public.is_group_admin())',t||'_w',t);
 end loop; end $$;

-- positions: everyone signed in reads the org chart; admins write
create policy positions_r on positions for select to authenticated using (true);
create policy positions_w on positions for all to authenticated using (public.is_group_admin()) with check (public.is_group_admin());

create policy profiles_r on profiles for select to authenticated using (true);
create policy profiles_w on profiles for all to authenticated using (id=auth.uid() or public.is_group_admin()) with check (id=auth.uid() or public.is_group_admin());

-- unit-scoped tables: see = unit members & group; write = planners of the unit
do $$ declare t text; begin
 foreach t in array array['unit_pillars','unit_goals','objectives','projects','plan_lines','actuals','cash_items','activity_plan_lines','funds','need_priority','plan_status','rescopes','kpis'] loop
  execute format('create policy %I on public.%I for select to authenticated using (public.can_see_unit(unit_id))',t||'_r',t);
  execute format('create policy %I on public.%I for all to authenticated using (public.can_plan_unit(unit_id)) with check (public.can_plan_unit(unit_id))',t||'_w',t);
 end loop; end $$;

-- key results and children follow their objective's unit; owners may check in
create policy key_results_r on key_results for select to authenticated using (public.can_see_unit(public.unit_of_obj(objective_id)));
create policy key_results_w on key_results for all to authenticated using (public.can_plan_unit(public.unit_of_obj(objective_id))) with check (public.can_plan_unit(public.unit_of_obj(objective_id)));
do $$ declare t text; begin
 foreach t in array array['kr_targets','kr_plan_links'] loop
  execute format('create policy %I on public.%I for select to authenticated using (public.can_see_unit(public.unit_of_kr(kr_id)))',t||'_r',t);
  execute format('create policy %I on public.%I for all to authenticated using (public.can_plan_unit(public.unit_of_kr(kr_id))) with check (public.can_plan_unit(public.unit_of_kr(kr_id)))',t||'_w',t);
 end loop; end $$;
create policy check_ins_r on check_ins for select to authenticated using (public.can_see_unit(public.unit_of_kr(kr_id)));
create policy check_ins_i on check_ins for insert to authenticated with check (public.can_plan_unit(public.unit_of_kr(kr_id)) or exists(select 1 from key_results k where k.id=kr_id and public.is_my_position(k.owner_position_id)));
create policy check_ins_d on check_ins for delete to authenticated using (created_by=auth.uid() or public.is_group_admin());

create policy cash_values_r on cash_values for select to authenticated using (exists(select 1 from cash_items c where c.id=item_id and public.can_see_unit(c.unit_id)));
create policy cash_values_w on cash_values for all to authenticated using (exists(select 1 from cash_items c where c.id=item_id and public.can_plan_unit(c.unit_id))) with check (exists(select 1 from cash_items c where c.id=item_id and public.can_plan_unit(c.unit_id)));
create policy kpi_values_r on kpi_values for select to authenticated using (exists(select 1 from kpis k where k.id=kpi_id and public.can_see_unit(k.unit_id)));
create policy kpi_values_w on kpi_values for all to authenticated using (exists(select 1 from kpis k where k.id=kpi_id and public.can_plan_unit(k.unit_id))) with check (exists(select 1 from kpis k where k.id=kpi_id and public.can_plan_unit(k.unit_id)));

-- deliverables & activities: unit sees; planners and the owner write
create policy deliverables_r on deliverables for select to authenticated using (public.can_see_unit(unit_id));
create policy deliverables_w on deliverables for all to authenticated using (public.can_plan_unit(unit_id) or public.is_my_position(owner_position_id)) with check (public.can_plan_unit(unit_id) or public.is_my_position(owner_position_id));
create policy activities_r on activities for select to authenticated using (public.can_see_unit(unit_id));
create policy activities_w on activities for all to authenticated using (public.can_plan_unit(unit_id) or public.is_my_position(owner_position_id)) with check (public.can_plan_unit(unit_id) or public.is_my_position(owner_position_id));

-- scorecards: the person, their unit's planners, group
create policy scorecards_r on scorecards for select to authenticated using (public.is_my_position(position_id) or exists(select 1 from positions p where p.id=position_id and public.can_plan_unit(p.unit_id)) or public.sees_all());
create policy scorecards_w on scorecards for all to authenticated using (public.is_my_position(position_id) or exists(select 1 from positions p where p.id=position_id and public.can_plan_unit(p.unit_id))) with check (public.is_my_position(position_id) or exists(select 1 from positions p where p.id=position_id and public.can_plan_unit(p.unit_id)));
create policy scorecard_items_r on scorecard_items for select to authenticated using (exists(select 1 from scorecards s where s.id=scorecard_id));
create policy scorecard_items_w on scorecard_items for all to authenticated using (exists(select 1 from scorecards s join positions p on p.id=s.position_id where s.id=scorecard_id and public.can_plan_unit(p.unit_id))) with check (exists(select 1 from scorecards s join positions p on p.id=s.position_id where s.id=scorecard_id and public.can_plan_unit(p.unit_id)));

-- comments: any signed-in user reads & posts; author deletes
create policy comments_r on comments for select to authenticated using (true);
create policy comments_i on comments for insert to authenticated with check (created_by=auth.uid());
create policy comments_d on comments for delete to authenticated using (created_by=auth.uid() or public.is_group_admin());

-- notifications: own only
create policy notifications_r on notifications for select to authenticated using (user_id=auth.uid());
create policy notifications_u on notifications for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

-- logs: group admins read
create policy audit_r on audit_log for select to authenticated using (public.is_group_admin());
create policy import_r on import_log for select to authenticated using (public.is_group_admin());

-- new auth user → profile, and link to a position with the same email if one is waiting
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,email,full_name) values (new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',split_part(new.email,'@',1))) on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table positions add column if not exists email text;
create index on positions(lower(email));
create or replace function public.claim_positions() returns int language plpgsql security definer set search_path=public as $$
declare n int; begin
  update positions set user_id=auth.uid() where user_id is null and email is not null and lower(email)=lower(auth.jwt()->>'email');
  get diagnostics n=row_count; return n; end $$;
