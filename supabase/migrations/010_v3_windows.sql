-- Individual objectives (personal OKRs) are kept apart from organisation objectives
alter table objectives drop constraint if exists objectives_level_check;
alter table objectives add constraint objectives_level_check check (level in ('unit','department','division','individual'));
alter table objectives add column if not exists submitted_at timestamptz, add column if not exists approved_by uuid references auth.users(id), add column if not exists approved_at timestamptz, add column if not exists review_note text;
update objectives o set level='individual' from positions p where p.id=o.owner_position_id and p.role='employee';

-- Owners can draft and edit their own objectives until approved
create or replace function public.can_edit_obj(o uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from objectives x where x.id=o and (public.can_plan_unit(x.unit_id) or (public.is_my_position(x.owner_position_id) and x.status<>'Approved'))) $$;
revoke execute on function public.can_edit_obj(uuid) from public, anon; grant execute on function public.can_edit_obj(uuid) to authenticated;
create policy objectives_own on objectives for all to authenticated
  using (public.is_my_position(owner_position_id) and status<>'Approved')
  with check (public.is_my_position(owner_position_id) and status in ('Draft','Submitted','Returned'));
drop policy if exists key_results_w on key_results;
create policy key_results_w on key_results for all to authenticated using (public.can_edit_obj(objective_id)) with check (public.can_edit_obj(objective_id));
create or replace function public.obj_of_kr(kid uuid) returns uuid language sql stable security definer set search_path=public as $$ select objective_id from key_results where id=kid $$;
revoke execute on function public.obj_of_kr(uuid) from public, anon; grant execute on function public.obj_of_kr(uuid) to authenticated;
do $$ declare t text; begin
 foreach t in array array['kr_targets','kr_plan_links','kr_month_targets'] loop
  execute format('drop policy if exists %I on public.%I', t||'_w', t);
  execute format('create policy %I on public.%I for all to authenticated using (public.can_edit_obj(public.obj_of_kr(kr_id))) with check (public.can_edit_obj(public.obj_of_kr(kr_id)))', t||'_w', t);
 end loop; end $$;
-- key-result owners may check in (already), and update confidence on their own key result
create policy key_results_owner_conf on key_results for update to authenticated using (public.is_my_position(owner_position_id)) with check (public.is_my_position(owner_position_id));

-- Notifications: any signed-in user can notify others through this function
create or replace function public.notify(user_ids uuid[], kind text, title text, body text default null, link text default null) returns int language plpgsql security definer set search_path=public as $$
declare n int; begin
  if not public.has_position() then return 0; end if;
  insert into notifications(user_id,kind,title,body,link) select distinct u, kind, title, body, link from unnest(user_ids) u where u is not null and u<>auth.uid();
  get diagnostics n=row_count; return n; end $$;
revoke execute on function public.notify(uuid[],text,text,text,text) from public, anon; grant execute on function public.notify(uuid[],text,text,text,text) to authenticated;
create policy notifications_d on notifications for delete to authenticated using (user_id=auth.uid());

-- Scorecards: the person agrees or asks to discuss
alter table scorecards add column if not exists agreed_at timestamptz, add column if not exists person_note text, add column if not exists proposed_at timestamptz;
alter table scorecard_items add column if not exists label text;

-- Framework and window settings
insert into app_settings(key,value) values
 ('framework','{"type":"okr","labels":{"pillar":"Pillar","goal":"Strategic goal","objective":"Objective","key_result":"Key result","deliverable":"Deliverable","activity":"Activity"}}'),
 ('windows','{"insights":["super_admin","group_strategy","executive","unit_head","planning_head","finance","dept_head","div_head"],"studio":["super_admin","group_strategy","planning_head","finance","unit_head"],"studio_admin":["super_admin","group_strategy"]}')
on conflict (key) do nothing;

-- Audit trail for the main planning tables
create or replace function public.audit() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into audit_log(table_name,row_id,action,old_data,new_data,by_user)
  values (tg_table_name, coalesce((case when tg_op='DELETE' then old.id else new.id end)::text,''), tg_op,
          case when tg_op<>'INSERT' then to_jsonb(old) end, case when tg_op<>'DELETE' then to_jsonb(new) end, auth.uid());
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
 foreach t in array array['objectives','key_results','plan_lines','plan_status','rescopes','scorecards','positions','unit_goals','unit_pillars','deliverables'] loop
  execute format('drop trigger if exists %I on public.%I', t||'_audit', t);
  execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit()', t||'_audit', t);
 end loop; end $$;