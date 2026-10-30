do $$ declare f text; begin
  foreach f in array array['public.can_plan_unit(uuid)','public.can_see_unit(uuid)','public.claim_positions()','public.is_group_admin()','public.is_my_position(uuid)','public.my_roles()','public.sees_all()','public.unit_of_kr(uuid)','public.unit_of_obj(uuid)','public.import_rows(text,jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.handle_new_user() from public, anon, authenticated';
end $$;