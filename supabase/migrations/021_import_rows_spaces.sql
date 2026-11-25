-- 021: import_rows conflict targets include the space column (keys changed in 020).
create or replace function public.import_rows(tbl text, rows jsonb) returns integer language plpgsql set search_path to 'public' as $function$
declare n int; cols text; conflict text; sets text;
begin
  if not public.is_group_admin() then raise exception 'Only Group admins can import'; end if;
  if tbl not in ('org_units','positions','group_pillars','group_goals','unit_pillars','unit_goals','objectives','key_results','kr_targets','kr_month_targets','check_ins','projects','plan_lines','actuals','cash_items','cash_values','activity_plan_lines','funds','need_priority','plan_status','kpis','kpi_values','deliverables','activities','week_reviews','scorecards','scorecard_items','pmo_projects','cash_actual','cash_weekly','fund_months','need_schedule','strategy_statements','rescopes','kr_plan_links') then
    raise exception 'Table % cannot be imported', tbl; end if;
  select string_agg(quote_ident(k),',') into cols from (select distinct jsonb_object_keys(x) k from jsonb_array_elements(rows) x) s
    where exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tbl and c.column_name=s.k);
  conflict := case tbl when 'cash_values' then '(item_id,month)' when 'funds' then '(unit_id,fiscal_year,quarter,space)' when 'need_priority' then '(unit_id,fiscal_year,need_key,space)'
     when 'plan_status' then '(unit_id,fiscal_year,plan_kind,period,space)' when 'kr_targets' then '(kr_id,quarter)' when 'kr_month_targets' then '(kr_id,month)' when 'kpi_values' then '(kpi_id,fiscal_year,month)'
     when 'cash_actual' then '(unit_id,fiscal_year,month,space)' when 'cash_weekly' then '(unit_id,week_start,direction,space)' when 'fund_months' then '(unit_id,fiscal_year,month,space)' when 'strategy_statements' then '(unit_id)' when 'kr_plan_links' then '(kr_id)' else '(id)' end;
  if tbl in ('positions','org_units') then
    execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict %s do nothing', tbl, cols, cols, tbl, conflict) using rows;
  else
    select string_agg(format('%1$I=coalesce(excluded.%1$I,%2$I.%1$I)',c,tbl),',') into sets from unnest(string_to_array(replace(cols,'"',''),',')) c;
    execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict %s do update set %s', tbl, cols, cols, tbl, conflict, sets) using rows;
  end if;
  get diagnostics n=row_count;
  insert into import_log(source,rows_read,rows_created,note) values ('import:'||tbl, jsonb_array_length(rows), n, null);
  return n;
end $function$;
