-- App edits to positions and the org chart win over a re-import
create or replace function public.import_rows(tbl text, rows jsonb) returns int language plpgsql security invoker set search_path=public as $$
declare n int; cols text; conflict text; sets text;
begin
  if not public.is_group_admin() then raise exception 'Only Group admins can import'; end if;
  if tbl not in ('org_units','positions','group_pillars','group_goals','unit_pillars','unit_goals','objectives','key_results','kr_targets','check_ins','projects','plan_lines','actuals','cash_items','cash_values','activity_plan_lines','funds','need_priority','plan_status','kpis','kpi_values') then
    raise exception 'Table % cannot be imported', tbl; end if;
  select string_agg(quote_ident(k),',') into cols from (select distinct jsonb_object_keys(r) k from jsonb_array_elements(rows) r) s
    where exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tbl and c.column_name=s.k);
  conflict := case tbl when 'cash_values' then '(item_id,month)' when 'funds' then '(unit_id,fiscal_year,quarter)' when 'need_priority' then '(unit_id,fiscal_year,need_key)'
     when 'plan_status' then '(unit_id,fiscal_year,plan_kind,period)' when 'kr_targets' then '(kr_id,quarter)' when 'kpi_values' then '(kpi_id,fiscal_year,month)' else '(id)' end;
  if tbl in ('positions','org_units') then
    execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict %s do nothing', tbl, cols, cols, tbl, conflict) using rows;
  else
    select string_agg(format('%1$I=coalesce(excluded.%1$I,%2$I.%1$I)',c,tbl),',') into sets from unnest(string_to_array(replace(cols,'"',''),',')) c;
    execute format('insert into %I (%s) select %s from jsonb_populate_recordset(null::%I, $1) on conflict %s do update set %s', tbl, cols, cols, tbl, conflict, sets) using rows;
  end if;
  get diagnostics n=row_count;
  insert into import_log(source,rows_read,rows_created,note) values ('import:'||tbl, jsonb_array_length(rows), n, null);
  return n;
end $$;

-- Self-linking: a new user picks their own position.
create table position_claims(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, email text, full_name text,
  position_id uuid references positions(id) on delete cascade, note text,
  status text not null default 'Pending' check (status in ('Linked','Pending','Approved','Rejected')),
  created_at timestamptz default now(), decided_by uuid references auth.users(id), decided_at timestamptz);
alter table position_claims enable row level security;
create policy position_claims_r on position_claims for select to authenticated using (user_id=auth.uid() or public.is_group_admin());

create or replace function public.unlinked_positions(q text) returns table(id uuid, holder_name text, title text, org text, unit text, role text)
language sql stable security definer set search_path=public as $$
  select p.id, p.holder_name, p.title, o.name, u.name, p.role from positions p join org_units o on o.id=p.org_unit_id left join org_units u on u.id=p.unit_id
  where p.user_id is null and auth.uid() is not null and length(trim(q))>=2 and p.role not in ('super_admin','group_strategy','executive')
    and (p.holder_name ilike '%'||trim(q)||'%' or p.title ilike '%'||trim(q)||'%')
  order by p.holder_name nulls last limit 25 $$;

-- Team-member positions link at once; leadership positions wait for Group Strategy.
create or replace function public.claim_position(pid uuid, note text default null) returns text language plpgsql security definer set search_path=public as $$
declare p positions; em text := auth.jwt()->>'email'; nm text; st text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists(select 1 from positions where user_id=auth.uid()) then return 'already'; end if;
  select full_name into nm from profiles where id=auth.uid();
  if pid is null then
    insert into position_claims(user_id,email,full_name,note,status) values (auth.uid(),em,nm,note,'Pending'); st:='Pending';
  else
    select * into p from positions where id=pid for update;
    if p.id is null or p.user_id is not null then raise exception 'That position is already taken. Choose another or ask Group Strategy.'; end if;
    if p.role in ('super_admin','group_strategy','executive') then raise exception 'This position is assigned by Group Strategy.'; end if;
    if p.role='employee' then
      update positions set user_id=auth.uid(), email=coalesce(email,em), status='Filled' where id=pid; st:='Linked';
    else st:='Pending'; end if;
    insert into position_claims(user_id,email,full_name,position_id,note,status) values (auth.uid(),em,nm,pid,note,st);
  end if;
  insert into notifications(user_id,kind,title,body,link)
    select distinct a.user_id,'claim', coalesce(nm,em)||case when st='Linked' then ' linked to ' else ' asks to be linked to ' end||coalesce(p.title,'a position (not listed)'), note, '/settings/people'
    from positions a where a.role in ('super_admin','group_strategy') and a.user_id is not null;
  return st;
end $$;

create or replace function public.decide_claim(cid uuid, approve boolean, pid uuid default null) returns text language plpgsql security definer set search_path=public as $$
declare c position_claims; target uuid;
begin
  if not public.is_group_admin() then raise exception 'Only Group Strategy can decide'; end if;
  select * into c from position_claims where id=cid;
  if c.id is null then raise exception 'Not found'; end if;
  target := coalesce(pid, c.position_id);
  if approve then
    if target is null then raise exception 'Choose the position to link'; end if;
    update positions set user_id=null where user_id=c.user_id;
    update positions set user_id=c.user_id, email=coalesce(c.email,email), status='Filled' where id=target;
    update position_claims set status='Approved', position_id=target, decided_by=auth.uid(), decided_at=now() where id=cid;
  else
    if c.status='Linked' then update positions set user_id=null where id=c.position_id and user_id=c.user_id; end if;
    update position_claims set status='Rejected', decided_by=auth.uid(), decided_at=now() where id=cid;
  end if;
  return 'ok';
end $$;

do $$ declare f text; begin
  foreach f in array array['public.unlinked_positions(text)','public.claim_position(uuid,text)','public.decide_claim(uuid,boolean,uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop; end $$;