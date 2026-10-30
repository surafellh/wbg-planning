-- price is one figure per line (not monthly); extra holds capex/project details from the workbook
alter table plan_lines alter column price0 type numeric using null, alter column price type numeric using null;
alter table plan_lines add column if not exists extra jsonb;
alter table objectives add column if not exists origin text not null default 'app';
alter table cash_items add column if not exists section text;

-- bootstrap: the Group, the Group Strategy Office and the Corporate Planning admin position.
-- The admin position is claimed automatically when srflhb22@gmail.com first signs in (claim_positions()).
insert into org_units(id,code,name,kind,unit_type,parent_id,unit_id,revenue_model,erp_name,sort,pilot) values
 ('052665fb-72de-5edb-9b20-cc7a19a26f89','group','Wagwago Business Group','group',null,null,null,'none','WAGWAGO TRADING PLC',0,true)
on conflict (id) do nothing;
insert into org_units(id,code,name,kind,unit_type,parent_id,unit_id,revenue_model,erp_name,sort,pilot) values
 ('56bdc553-5f16-5df4-be26-a996e0de5165','group-strategy-office','Group Strategy Office','unit','function','052665fb-72de-5edb-9b20-cc7a19a26f89','56bdc553-5f16-5df4-be26-a996e0de5165','none','CEO Office / Planning',99,false)
on conflict (id) do nothing;
insert into positions(id,org_unit_id,unit_id,title,level,role,holder_name,email,status,sort) values
 ('8d01c8b1-bb2d-5e4b-a4a2-87ae04c65799','56bdc553-5f16-5df4-be26-a996e0de5165','56bdc553-5f16-5df4-be26-a996e0de5165','Corporate Planning','group','super_admin','Suhay','srflhb22@gmail.com','Filled',0)
on conflict (id) do nothing;

-- bulk import used by Settings → Data import (group admins only; RLS still applies to each row)
create or replace function public.import_rows(tbl text, rows jsonb) returns int language plpgsql security invoker set search_path=public as $$
declare n int; cols text; conflict text;
begin
  if not public.is_group_admin() then raise exception 'Only Group admins can import'; end if;
  if tbl not in ('org_units','positions','group_pillars','group_goals','unit_pillars','unit_goals','objectives','key_results','kr_targets','check_ins','projects','plan_lines','actuals','cash_items','cash_values','activity_plan_lines','funds','need_priority','plan_status','kpis','kpi_values') then
    raise exception 'Table % cannot be imported', tbl; end if;
  select string_agg(quote_ident(k),',') into cols from (select distinct jsonb_object_keys(r) k from jsonb_array_elements(rows) r) s
    where exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tbl and c.column_name=s.k);
  conflict := case tbl when 'cash_values' then '(item_id,month)' when 'funds' then '(unit_id,fiscal_year,quarter)' when 'need_priority' then '(unit_id,fiscal_year,need_key)'
     when 'plan_status' then '(unit_id,fiscal_year,plan_kind,period)' when 'kr_targets' then '(kr_id,quarter)' when 'kpi_values' then '(kpi_id,fiscal_year,month)' else '(id)' end;
  execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict %s do update set %s',
     tbl, cols, cols, tbl, conflict,
     (select string_agg(format('%1$I=excluded.%1$I',c),',') from unnest(string_to_array(replace(cols,'"',''),',')) c)) using rows;
  get diagnostics n=row_count;
  insert into import_log(source,rows_read,rows_created,note) values ('import:'||tbl, jsonb_array_length(rows), n, null);
  return n;
end $$;
create policy import_log_i on import_log for insert to authenticated with check (public.is_group_admin());
