-- v5: department and division heads plan their own OKRs in Studio; key-result updaters can check in;
-- financial actuals can be entered by the roles/organisations chosen in Studio → Configuration → Access.

-- 1. Studio window for department and division heads (they build their organisation's OKRs)
update app_settings set value = jsonb_set(value, '{studio}',
  (select to_jsonb(array(select distinct x from jsonb_array_elements_text(coalesce(value->'studio','[]'::jsonb) || '["dept_head","div_head"]'::jsonb) x))))
where key = 'windows';

-- 2. A named updater of a key result may record check-ins
drop policy if exists check_ins_i on check_ins;
create policy check_ins_i on check_ins for insert to authenticated with check (
  public.can_plan_unit(public.unit_of_kr(kr_id))
  or exists(select 1 from key_results k where k.id = kr_id and (public.is_my_position(k.owner_position_id) or public.is_my_position(k.updater_position_id))));

-- 3. Who may enter financial actuals (configurable)
create or replace function public.can_enter_actuals(u uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.can_plan_unit(u) or exists(
    select 1 from positions p, app_settings s
    where s.key = 'actuals_entry' and p.user_id = auth.uid() and p.unit_id = u
      and ((s.value->'roles') ? p.role or (s.value->'org_unit_ids') ? p.org_unit_id::text))
$$;
revoke execute on function public.can_enter_actuals(uuid) from public, anon; grant execute on function public.can_enter_actuals(uuid) to authenticated;
drop policy if exists actuals_w on actuals;
create policy actuals_w on actuals for all to authenticated using (public.can_enter_actuals(unit_id)) with check (public.can_enter_actuals(unit_id));
drop policy if exists cash_actual_w on cash_actual;
create policy cash_actual_w on cash_actual for all to authenticated using (public.can_enter_actuals(unit_id)) with check (public.can_enter_actuals(unit_id));
drop policy if exists cash_weekly_w on cash_weekly;
create policy cash_weekly_w on cash_weekly for all to authenticated using (public.can_enter_actuals(unit_id)) with check (public.can_enter_actuals(unit_id));

-- 4. Scoring defaults made explicit (editable in Studio → Configuration → Scoring)
insert into app_settings(key, value) values
  ('own_share', '{"unit":50,"department":50,"division":50}'),
  ('result_rules', '{"unit":{"share":70,"source":"led"},"department":{"share":60,"source":"led"},"division":{"share":50,"source":"led"},"employee":{"share":30,"source":"own"}}'),
  ('actuals_entry', '{"roles":["super_admin","group_strategy","finance","planning_head","unit_head"],"org_unit_ids":[]}'),
  ('approvals', '{}'), ('notify', '{}'), ('calendar', '{"cutoffDay":7,"cutoffHour":14,"monthClose":9}'), ('work_pages', '{}'), ('erp_replan', '{}')
on conflict (key) do nothing;
-- carry over any organisation shares already set
update app_settings r set value = jsonb_build_object(
  'unit', jsonb_build_object('share', coalesce((w.value->>'unit')::numeric, 70), 'source', 'led'),
  'department', jsonb_build_object('share', coalesce((w.value->>'department')::numeric, 60), 'source', 'led'),
  'division', jsonb_build_object('share', coalesce((w.value->>'division')::numeric, 50), 'source', 'led'),
  'employee', jsonb_build_object('share', coalesce((w.value->>'employee')::numeric, 30), 'source', 'own'))
from app_settings w where r.key = 'result_rules' and w.key = 'org_weights';
