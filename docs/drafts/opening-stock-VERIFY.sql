-- REVIEW ONLY — NATIVE POSTGRESQL UNQUALIFIED. Catalog only; no RPC calls.
begin;
set transaction read only;
set local search_path = public, pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $catalog_pin$
declare
  v_oid oid;
  v_table text;
  v_expected text[];
begin
  -- Exact new overload set; no hidden overload is accepted.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('confirm_opening_stock','list_opening_stock_lot_metadata')) <> 2 then
    raise exception 'Opening RPC overload drift.';
  end if;
  v_oid := to_regprocedure('public.confirm_opening_stock(uuid,uuid,date,jsonb)');
  if v_oid is null or not exists (select 1 from pg_proc p where p.oid=v_oid
    and p.proowner = 'postgres'::regrole and p.prosecdef
    and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and p.prokind='f' and p.provolatile='v' and p.proparallel='u'
    and not p.proisstrict and not p.proleakproof
    and p.prosupport = 0 and p.procost = 100
    and p.prorows = case when p.proretset then 1000 else 0 end
    and p.prorettype='uuid'::regtype and p.proretset=false
    and p.proargnames = array['target_pharmacy_id','operation_id','physical_count_date','opening_items']::text[]
    and p.pronargdefaults = 0
    and pg_get_expr(p.proargdefaults,0) is not distinct from null
    and p.proconfig = array['search_path=public, pg_temp']::text[]
    and p.prosrc = $pin_confirm_opening_stock$
declare
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_today date;
  v_payload jsonb;
  v_existing public.opening_stock_receipts%rowtype;
  v_receipt uuid;
  v_line jsonb;
  v_mapped jsonb := '[]'::jsonb;
  v_keys text[] := array['product_id', 'packaging_unit_id', 'quantity',
    'cost_per_packaging_unit', 'batch_unknown', 'manufacturer_batch',
    'internal_lot_reference', 'expiry_precision', 'expiry_label'];
  v_quantity numeric;
  v_cost numeric;
  v_ref text;
  v_batch text;
  v_unknown boolean;
  v_label text;
  v_precision text;
  v_year integer;
  v_month integer;
  v_day integer;
  v_cutoff date;
  v_seen text[] := array[]::text[];
  v_item uuid;
  v_batch_id uuid;
  v_product uuid;
begin
  if v_actor is null then
    raise exception 'Please sign in to record opening stock.' using errcode = '42501';
  end if;
  if target_pharmacy_id is null or operation_id is null then
    raise exception 'Pharmacy and operation reference required.' using errcode = '22023';
  end if;
  -- First lock is exactly the pharmacy lock used by normal receipts.
  perform 1 from public.pharmacies p
    where p.id = target_pharmacy_id and p.is_active = true for update;
  if not found then raise exception 'Active pharmacy not found.'; end if;
  if not exists (select 1 from public.pharmacy_members m
    where m.pharmacy_id = target_pharmacy_id and m.user_id = v_actor
      and m.is_active = true and m.role in ('owner', 'pharmacist')) then
    raise exception 'Only an active owner or pharmacist can record opening stock.'
      using errcode = '42501';
  end if;
  -- Preserve original JSONB, array order, label spelling and JSON nulls, not mapped data.
  v_payload := jsonb_build_object('target_pharmacy_id', target_pharmacy_id,
    'operation_id', operation_id, 'physical_count_date', physical_count_date,
    'opening_items', opening_items);
  select r.* into v_existing from public.opening_stock_receipts r
    where r.pharmacy_id = target_pharmacy_id and r.operation_id = confirm_opening_stock.operation_id;
  if found then
    if v_existing.actor_user_id is distinct from v_actor
      or v_existing.request_payload is distinct from v_payload then
      raise exception 'Opening operation reference was used for a different request or actor.'
        using errcode = '22023';
    end if;
    return v_existing.receipt_id;
  end if;
  if exists (select 1 from public.stock_receipts r
    where r.pharmacy_id = target_pharmacy_id
      and r.client_operation_id = confirm_opening_stock.operation_id) then
    raise exception 'Operation reference belongs to a non-opening receipt.' using errcode = '22023';
  end if;
  -- A committed historical retry has returned BEFORE any moving date validation.
  v_today := (v_now at time zone 'Africa/Lagos')::date;
  if physical_count_date is null or not isfinite(physical_count_date)
    or physical_count_date < date '0001-01-01'
    or physical_count_date > date '9999-12-31'
    or physical_count_date > v_today then
    raise exception 'Physical count date must be a real nonfuture date.' using errcode = '22023';
  end if;
  if opening_items is null or jsonb_typeof(opening_items) is distinct from 'array' then
    raise exception 'Opening items must be an array.' using errcode = '22023';
  end if;
  if jsonb_array_length(opening_items) not between 1 and 100 then
    raise exception 'Opening stock requires 1 to 100 items.' using errcode = '22023';
  end if;
  for v_line in select e.value from jsonb_array_elements(opening_items) e(value) loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'Opening item must be an object.' using errcode = '22023';
    end if;
    if not (v_line ?& v_keys) or v_line - v_keys <> '{}'::jsonb
      or jsonb_typeof(v_line->'product_id') is distinct from 'string'
      or jsonb_typeof(v_line->'packaging_unit_id') is distinct from 'string'
      or jsonb_typeof(v_line->'quantity') is distinct from 'number'
      or jsonb_typeof(v_line->'cost_per_packaging_unit') is distinct from 'number'
      or jsonb_typeof(v_line->'batch_unknown') is distinct from 'boolean'
      or jsonb_typeof(v_line->'manufacturer_batch') not in ('string', 'null')
      or jsonb_typeof(v_line->'internal_lot_reference') is distinct from 'string'
      or jsonb_typeof(v_line->'expiry_precision') is distinct from 'string'
      or jsonb_typeof(v_line->'expiry_label') is distinct from 'string' then
      raise exception 'Opening item keys and JSON types must match the exact contract.' using errcode = '22023';
    end if;
    if (v_line->>'product_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or (v_line->>'packaging_unit_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Canonical UUID fields required.' using errcode = '22023';
    end if;
    v_quantity := (v_line->>'quantity')::numeric;
    v_cost := (v_line->>'cost_per_packaging_unit')::numeric;
    v_ref := v_line->>'internal_lot_reference';
    v_unknown := (v_line->>'batch_unknown')::boolean;
    if v_quantity <= 0 or v_quantity >= 1000000000000
      or v_quantity <> round(v_quantity, 6)
      or v_cost <= 0 or v_cost >= 1000000000000
      or v_cost <> round(v_cost, 6)
      or round(v_quantity * v_cost, 2) >= 10000000000000000
      or v_ref <> btrim(v_ref) or length(v_ref) not between 1 and 50
      or v_ref = any(v_seen) then
      raise exception 'Invalid quantity, explicit positive cost or unique internal lot reference.' using errcode = '22023';
    end if;
    v_seen := array_append(v_seen, v_ref);
    if exists (select 1 from public.opening_stock_lots l
      where l.pharmacy_id = target_pharmacy_id and l.internal_lot_reference = v_ref) then
      raise exception 'Internal lot reference already exists in this pharmacy.' using errcode = '22023';
    end if;
    if (v_unknown and jsonb_typeof(v_line->'manufacturer_batch') <> 'null')
      or (not v_unknown and (jsonb_typeof(v_line->'manufacturer_batch') <> 'string'
        or length(v_line->>'manufacturer_batch') not between 1 and 100
        or (v_line->>'manufacturer_batch') <> btrim(v_line->>'manufacturer_batch'))) then
      raise exception 'Unknown batch requires JSON null; known batch requires a real manufacturer batch.' using errcode = '22023';
    end if;
    v_precision := v_line->>'expiry_precision';
    v_label := v_line->>'expiry_label';
    if v_precision = 'month' and v_label ~ '^[0-9]{2}/[0-9]{4}$' then
      v_year := substring(v_label from 4 for 4)::integer;
      v_month := substring(v_label from 1 for 2)::integer;
      v_day := 1;
    elsif v_precision = 'month' and v_label ~ '^[0-9]{4}-[0-9]{2}$' then
      v_year := substring(v_label from 1 for 4)::integer;
      v_month := substring(v_label from 6 for 2)::integer;
      v_day := 1;
    elsif v_precision = 'day' and v_label ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      v_year := substring(v_label from 1 for 4)::integer;
      v_month := substring(v_label from 6 for 2)::integer;
      v_day := substring(v_label from 9 for 2)::integer;
    else
      raise exception 'Expiry must be MM/YYYY, YYYY-MM (month) or YYYY-MM-DD (day).' using errcode = '22023';
    end if;
    if v_year not between 1 and 9999 or v_month not between 1 and 12
      or v_day not between 1 and 31 or (v_precision = 'month' and v_year = 9999 and v_month = 12) then
      raise exception 'Expiry date outside supported range.' using errcode = '22023';
    end if;
    begin
      v_cutoff := make_date(v_year, v_month, v_day);
    exception when datetime_field_overflow then
      raise exception 'Expiry is not a real calendar date.' using errcode = '22023';
    end;
    if v_precision = 'month' then
      v_cutoff := (v_cutoff + interval '1 month')::date;
    end if;
    if v_cutoff <= v_today then
      raise exception 'Opening stock stop-sale date must be after today.' using errcode = '22023';
    end if;
    -- <= 91 characters even with a 50-character internal ref; manufacturer value
    -- is stored separately, never truncated into a misleading manufacturer batch.
    v_batch := 'INTERNAL LOT ' || v_ref || case when v_unknown
      then ' — manufacturer batch unknown' else ' — manufacturer batch recorded' end;
    if length(v_batch) > 100 then raise exception 'Internal batch mapping too long.'; end if;
    v_mapped := v_mapped || jsonb_build_array(jsonb_build_object(
      'product_id', v_line->'product_id', 'packaging_unit_id', v_line->'packaging_unit_id',
      'quantity', v_line->'quantity', 'cost_per_packaging_unit', v_line->'cost_per_packaging_unit',
      'batch_number', v_batch, 'expiry_date', to_char(v_cutoff, 'YYYY-MM-DD')));
  end loop;
  -- Unchanged writer enforces active tenant product/unit, ordered locks, all
  -- conversion/base quantity bounds and expiry checks. No payment/expense/debt.
  -- Actual operation time is the unchanged writer's clock_timestamp(), NOT count date.
  v_receipt := public.confirm_stock_receipt(target_pharmacy_id, operation_id,
    'Opening stock — physical count', 'Opening count ' || to_char(physical_count_date, 'YYYY-MM-DD'), v_mapped);
  insert into public.opening_stock_receipts
    (receipt_id, pharmacy_id, operation_id, actor_user_id, physical_count_date, request_payload)
    values (v_receipt, target_pharmacy_id, operation_id, v_actor, physical_count_date, v_payload);
  -- Unique internal refs make mapped batch labels unique within this receipt.
  -- Join actual batch/item keys rather than relying on the underlying writer's loop order.
  for v_line in select e.value from jsonb_array_elements(opening_items) e(value) loop
    v_ref := v_line->>'internal_lot_reference';
    v_unknown := (v_line->>'batch_unknown')::boolean;
    v_batch := 'INTERNAL LOT ' || v_ref || case when v_unknown
      then ' — manufacturer batch unknown' else ' — manufacturer batch recorded' end;
    select i.id, b.id, i.product_id into strict v_item, v_batch_id, v_product
      from public.stock_receipt_items i join public.stock_batches b
        on b.receipt_item_id = i.id and b.pharmacy_id = i.pharmacy_id and b.product_id = i.product_id
      where i.receipt_id = v_receipt and i.pharmacy_id = target_pharmacy_id and i.batch_number = v_batch;
    insert into public.opening_stock_lots
      (batch_id, pharmacy_id, receipt_item_id, product_id, internal_lot_reference,
       batch_unknown, manufacturer_batch, expiry_precision, expiry_label, expiry_cutoff_date)
      select v_batch_id, target_pharmacy_id, v_item, v_product, v_ref, v_unknown,
        v_line->>'manufacturer_batch', v_line->>'expiry_precision', v_line->>'expiry_label', b.expiry_date
      from public.stock_batches b where b.id = v_batch_id and b.pharmacy_id = target_pharmacy_id;
  end loop;
  return v_receipt;
end;
$pin_confirm_opening_stock$) then
    raise exception 'Exact confirm_opening_stock source/signature/security drift.';
  end if;
  -- Exact ACL tuples, including grantor and grant option, not only public denial.
  if exists (
    (select x.grantor,x.grantee,x.privilege_type,x.is_grantable
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid=v_oid
     except select 'postgres'::regrole::oid,v.role_id,'EXECUTE'::text,false
       from (values ('postgres'::regrole::oid),('authenticated'::regrole::oid)) v(role_id))
    union all
    (select 'postgres'::regrole::oid,v.role_id,'EXECUTE'::text,false
       from (values ('postgres'::regrole::oid),('authenticated'::regrole::oid)) v(role_id)
     except select x.grantor,x.grantee,x.privilege_type,x.is_grantable
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid=v_oid)
  ) then raise exception 'confirm_opening_stock ACL drift or unexpected inherited defaults.'; end if;
  if has_function_privilege('anon',v_oid,'EXECUTE')
    or has_function_privilege('service_role',v_oid,'EXECUTE') then
    raise exception 'Unexpected effective API RPC privileges.';
  end if;
  if exists (select 1 from pg_proc p where p.oid=v_oid and
    (p.proallargtypes is not null or p.proargmodes is not null)) then
    raise exception 'Writer return tuple drift.'; end if;
  v_oid := to_regprocedure('public.list_opening_stock_lot_metadata(uuid,uuid,integer)');
  if v_oid is null or not exists (select 1 from pg_proc p where p.oid=v_oid
    and p.proowner = 'postgres'::regrole and p.prosecdef
    and p.prolang=(select oid from pg_language where lanname='plpgsql')
    and p.prokind='f' and p.provolatile='s' and p.proparallel='u'
    and not p.proisstrict and not p.proleakproof
    and p.prosupport = 0 and p.procost = 100
    and p.prorows = case when p.proretset then 1000 else 0 end
    and p.prorettype='record'::regtype and p.proretset=true
    and p.proargnames = array['target_pharmacy_id','after_batch_id','page_limit','batch_id','internal_lot_reference','batch_unknown','manufacturer_batch','expiry_precision','expiry_label','expiry_cutoff_date','physical_count_date']::text[]
    and p.pronargdefaults = 2
    and pg_get_expr(p.proargdefaults,0) is not distinct from 'NULL::uuid, 250'
    and p.proconfig = array['search_path=public, pg_temp']::text[]
    and p.prosrc = $pin_list_opening_stock_lot_metadata$
begin
  if target_pharmacy_id is null or auth.uid() is null or not exists (
    select 1 from public.pharmacy_members m join public.pharmacies p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id and m.user_id = auth.uid()
      and m.is_active = true and p.is_active = true) then
    raise exception 'Active pharmacy membership required.' using errcode = '42501';
  end if;
  if page_limit is null or page_limit not between 1 and 250 then
    raise exception 'Page limit must be 1 to 250.' using errcode = '22023';
  end if;
  return query select l.batch_id, l.internal_lot_reference, l.batch_unknown,
    l.manufacturer_batch, l.expiry_precision, l.expiry_label,
    l.expiry_cutoff_date, r.physical_count_date
    from public.opening_stock_lots l
    join public.stock_receipt_items i on i.id = l.receipt_item_id and i.pharmacy_id = l.pharmacy_id
    join public.opening_stock_receipts r on r.receipt_id = i.receipt_id and r.pharmacy_id = l.pharmacy_id
    where l.pharmacy_id = target_pharmacy_id and (after_batch_id is null or l.batch_id > after_batch_id)
    order by l.batch_id limit page_limit;
end;
$pin_list_opening_stock_lot_metadata$) then
    raise exception 'Exact list_opening_stock_lot_metadata source/signature/security drift.';
  end if;
  -- Exact ACL tuples, including grantor and grant option, not only public denial.
  if exists (
    (select x.grantor,x.grantee,x.privilege_type,x.is_grantable
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid=v_oid
     except select 'postgres'::regrole::oid,v.role_id,'EXECUTE'::text,false
       from (values ('postgres'::regrole::oid),('authenticated'::regrole::oid)) v(role_id))
    union all
    (select 'postgres'::regrole::oid,v.role_id,'EXECUTE'::text,false
       from (values ('postgres'::regrole::oid),('authenticated'::regrole::oid)) v(role_id)
     except select x.grantor,x.grantee,x.privilege_type,x.is_grantable
      from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid=v_oid)
  ) then raise exception 'list_opening_stock_lot_metadata ACL drift or unexpected inherited defaults.'; end if;
  if has_function_privilege('anon',v_oid,'EXECUTE')
    or has_function_privilege('service_role',v_oid,'EXECUTE') then
    raise exception 'Unexpected effective API RPC privileges.';
  end if;
  if not exists (select 1 from pg_proc p where p.oid=v_oid
    and p.proargmodes=array['i','i','i','t','t','t','t','t','t','t','t']::"char"[]
    and p.proallargtypes=array['uuid'::regtype::oid,'uuid'::regtype::oid,'integer'::regtype::oid,
      'uuid'::regtype::oid,'text'::regtype::oid,'boolean'::regtype::oid,'text'::regtype::oid,
      'text'::regtype::oid,'text'::regtype::oid,'date'::regtype::oid,'date'::regtype::oid]) then
    raise exception 'Reader return tuple drift.'; end if;
  v_table := 'public.opening_stock_receipts';
  v_oid := to_regclass(v_table);
  if v_oid is null or not exists (select 1 from pg_class c where c.oid=v_oid
    and c.relkind='r' and c.relpersistence='p' and c.relowner='postgres'::regrole
    and c.relrowsecurity and not c.relforcerowsecurity and not c.relispartition
    and c.reloptions is null) then raise exception 'Opening table security/owner drift.'; end if;
  if exists (select 1 from pg_policy where polrelid=v_oid)
    or exists (select 1 from pg_trigger where tgrelid=v_oid and not tgisinternal)
    or exists (select 1 from pg_rewrite where ev_class=v_oid)
    or exists (select 1 from pg_inherits where inhrelid=v_oid or inhparent=v_oid) then
    raise exception 'Unexpected opening policies, triggers, rules or inheritance.'; end if;
  select array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text order by a.attnum)
    into v_expected from pg_attribute a where a.attrelid=v_oid and a.attnum>0 and not a.attisdropped;
  if v_expected is distinct from array['receipt_id:uuid:true','pharmacy_id:uuid:true','operation_id:uuid:true','actor_user_id:uuid:true','physical_count_date:date:true','request_payload:jsonb:true']::text[] then
    raise exception 'Opening table column contract drift.'; end if;
  if exists (select 1 from pg_attribute a where a.attrelid=v_oid and a.attnum>0
    and (a.attisdropped or a.atthasdef or a.attidentity<>'' or a.attgenerated<>'' or a.attacl is not null
      or a.attcollation <> case when a.atttypid = 'text'::regtype
        then 'pg_catalog.default'::regcollation::oid else 0 end)) then
    raise exception 'Unexpected opening column default/generated/ACL state.'; end if;
  -- Compare all constraint definitions, not just names or counts. Whitespace only
  -- is removed; operators, values, Boolean grouping and FK actions remain pinned.
  select array_agg(regexp_replace(pg_get_constraintdef(c.oid,false),'\s','','g') order by regexp_replace(pg_get_constraintdef(c.oid,false),'\s','','g') collate "C")
    into v_expected from pg_constraint c where c.conrelid=v_oid;
  if v_expected is distinct from array['CHECK((jsonb_typeof(request_payload)=''object''::text))','CHECK(isfinite(physical_count_date))','FOREIGNKEY(actor_user_id)REFERENCESauth.users(id)ONDELETERESTRICT','FOREIGNKEY(pharmacy_id,receipt_id)REFERENCESstock_receipts(pharmacy_id,id)ONDELETERESTRICT','PRIMARYKEY(receipt_id)','UNIQUE(pharmacy_id,operation_id)']::text[]
    or exists (select 1 from pg_constraint c where c.conrelid=v_oid
      and (not c.convalidated or c.condeferrable or c.condeferred or not c.conislocal)) then
    raise exception 'Exact opening constraints drift (native deparse qualification required).'; end if;
  if exists (
    (select x.grantor,x.grantee,x.privilege_type,x.is_grantable from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where c.oid=v_oid
     except select * from aclexplode(acldefault('r','postgres'::regrole)))
    union all
    (select * from aclexplode(acldefault('r','postgres'::regrole))
     except select x.grantor,x.grantee,x.privilege_type,x.is_grantable from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where c.oid=v_oid)
  ) then raise exception 'Opening table exact owner-only ACL drift.'; end if;
  if exists (select 1 from pg_roles role_to_check cross join
    (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) priv(name)
    where role_to_check.rolname in ('anon','authenticated','service_role')
      and has_table_privilege(role_to_check.oid,v_oid,priv.name)) then
    raise exception 'Unexpected effective direct API table rights.'; end if;
  if exists (select 1 from pg_index i where i.indrelid=v_oid and
    (not i.indisvalid or not i.indisready or not i.indisunique or i.indpred is not null
     or i.indexprs is not null or not exists (select 1 from pg_constraint c where c.conindid=i.indexrelid))) then
    raise exception 'Unexpected opening index shape.'; end if;
  v_table := 'public.opening_stock_lots';
  v_oid := to_regclass(v_table);
  if v_oid is null or not exists (select 1 from pg_class c where c.oid=v_oid
    and c.relkind='r' and c.relpersistence='p' and c.relowner='postgres'::regrole
    and c.relrowsecurity and not c.relforcerowsecurity and not c.relispartition
    and c.reloptions is null) then raise exception 'Opening table security/owner drift.'; end if;
  if exists (select 1 from pg_policy where polrelid=v_oid)
    or exists (select 1 from pg_trigger where tgrelid=v_oid and not tgisinternal)
    or exists (select 1 from pg_rewrite where ev_class=v_oid)
    or exists (select 1 from pg_inherits where inhrelid=v_oid or inhparent=v_oid) then
    raise exception 'Unexpected opening policies, triggers, rules or inheritance.'; end if;
  select array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text order by a.attnum)
    into v_expected from pg_attribute a where a.attrelid=v_oid and a.attnum>0 and not a.attisdropped;
  if v_expected is distinct from array['batch_id:uuid:true','pharmacy_id:uuid:true','receipt_item_id:uuid:true','product_id:uuid:true','internal_lot_reference:text:true','batch_unknown:boolean:true','manufacturer_batch:text:false','expiry_precision:text:true','expiry_label:text:true','expiry_cutoff_date:date:true']::text[] then
    raise exception 'Opening table column contract drift.'; end if;
  if exists (select 1 from pg_attribute a where a.attrelid=v_oid and a.attnum>0
    and (a.attisdropped or a.atthasdef or a.attidentity<>'' or a.attgenerated<>'' or a.attacl is not null
      or a.attcollation <> case when a.atttypid = 'text'::regtype
        then 'pg_catalog.default'::regcollation::oid else 0 end)) then
    raise exception 'Unexpected opening column default/generated/ACL state.'; end if;
  -- Compare all constraint definitions, not just names or counts. Whitespace only
  -- is removed; operators, values, Boolean grouping and FK actions remain pinned.
  select array_agg(regexp_replace(pg_get_constraintdef(c.oid,false),'\s','','g') order by regexp_replace(pg_get_constraintdef(c.oid,false),'\s','','g') collate "C")
    into v_expected from pg_constraint c where c.conrelid=v_oid;
  if v_expected is distinct from array['CHECK(((batch_unknownAND(manufacturer_batchISNULL))OR((NOTbatch_unknown)AND(manufacturer_batchISNOTNULL)AND(manufacturer_batch=btrim(manufacturer_batch))AND((length(manufacturer_batch)>=1)AND(length(manufacturer_batch)<=100)))))','CHECK(((internal_lot_reference=btrim(internal_lot_reference))AND((length(internal_lot_reference)>=1)AND(length(internal_lot_reference)<=50))))','CHECK((expiry_precision=ANY(ARRAY[''month''::text,''day''::text])))','CHECK(isfinite(expiry_cutoff_date))','FOREIGNKEY(pharmacy_id,batch_id,product_id)REFERENCESstock_batches(pharmacy_id,id,product_id)ONDELETERESTRICT','FOREIGNKEY(pharmacy_id,receipt_item_id,product_id)REFERENCESstock_receipt_items(pharmacy_id,id,product_id)ONDELETERESTRICT','PRIMARYKEY(batch_id)','UNIQUE(pharmacy_id,internal_lot_reference)','UNIQUE(receipt_item_id)']::text[]
    or exists (select 1 from pg_constraint c where c.conrelid=v_oid
      and (not c.convalidated or c.condeferrable or c.condeferred or not c.conislocal)) then
    raise exception 'Exact opening constraints drift (native deparse qualification required).'; end if;
  if exists (
    (select x.grantor,x.grantee,x.privilege_type,x.is_grantable from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where c.oid=v_oid
     except select * from aclexplode(acldefault('r','postgres'::regrole)))
    union all
    (select * from aclexplode(acldefault('r','postgres'::regrole))
     except select x.grantor,x.grantee,x.privilege_type,x.is_grantable from pg_class c
      cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x where c.oid=v_oid)
  ) then raise exception 'Opening table exact owner-only ACL drift.'; end if;
  if exists (select 1 from pg_roles role_to_check cross join
    (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) priv(name)
    where role_to_check.rolname in ('anon','authenticated','service_role')
      and has_table_privilege(role_to_check.oid,v_oid,priv.name)) then
    raise exception 'Unexpected effective direct API table rights.'; end if;
  if exists (select 1 from pg_index i where i.indrelid=v_oid and
    (not i.indisvalid or not i.indisready or not i.indisunique or i.indpred is not null
     or i.indexprs is not null or not exists (select 1 from pg_constraint c where c.conindid=i.indexrelid))) then
    raise exception 'Unexpected opening index shape.'; end if;
end;
$catalog_pin$;
do $action_pin$
begin
  if not exists (select 1 from pg_proc p where p.oid=to_regprocedure('public.get_pharmacy_action_candidates(uuid)')
    and p.prosrc = $forward_action$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_day jsonb;
begin
  if not exists (
    select 1
    from public.pharmacy_members as m
    join public.pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.is_active = true
      and m.role = 'owner'
  ) then
    raise exception 'Only an active owner can manage pharmacy actions.'
      using errcode = '42501';
  end if;

  v_day := public.get_pharmacy_day_summary(target_pharmacy_id, v_today);

  return query
  select
    v_today,
    'out_of_stock:' || i.product_id::text,
    'out_of_stock'::text,
    'critical'::text,
    left(i.product_name, 220) || ' has no unexpired stock',
    'No unexpired stock is available. Review inventory and confirm purchasing needs before reordering.'::text,
    jsonb_build_object(
      'product_id', i.product_id,
      'product_name', i.product_name,
      'available_quantity', i.available_quantity,
      'base_unit_label', i.base_unit_label,
      'as_of_date', v_today
    )
  from public.list_pharmacy_inventory(target_pharmacy_id) as i
  where i.is_active = true
    and i.available_quantity::numeric <= 0;

  return query
  select
    v_today,
    case when b.expiry_date <= v_today
      then 'expired_batch:' else 'expiring_batch:'
    end || b.batch_id::text,
    case when b.expiry_date <= v_today
      then 'expired_batch' else 'expiring_batch'
    end,
    case when b.expiry_date <= v_today
      then 'critical' else 'warning'
    end,
    left(b.product_name, 180) ||
      case when b.expiry_date <= v_today
        then ' has stock past its stop-sale date'
        else ' has stock reaching its stop-sale date within 30 days'
      end,
    'Stock lot ' || left(b.batch_number, 100) ||
      ' has stop-sale date ' || b.expiry_date::text ||
      '. Remaining quantity: ' || b.remaining_quantity ||
      ' ' || left(b.base_unit_label, 100) ||
      case when b.expiry_date <= v_today
        then '. Review and separate it from saleable stock.'
        else '. Review the stock lot and plan an appropriate stock action.'
      end,
    jsonb_build_object(
      'batch_id', b.batch_id,
      'product_id', b.product_id,
      'product_name', b.product_name,
      'batch_number', b.batch_number,
      'expiry_date', b.expiry_date,
      'remaining_quantity', b.remaining_quantity,
      'base_unit_label', b.base_unit_label,
      'stock_value', b.stock_value,
      'as_of_date', v_today
    )
  from public.list_pharmacy_stock_batches(target_pharmacy_id) as b
  where b.remaining_quantity::numeric > 0
    and b.expiry_date <= v_today + 30;

  if v_day->'closure' = 'null'::jsonb then
    return query
    select
      v_today,
      'unreconciled_day'::text,
      'unreconciled_day'::text,
      'info'::text,
      'Today has no saved cash reconciliation'::text,
      'The business day is open. Review opening cash and count the drawer when trading is finished. This is a reminder, not evidence of a cash shortage.'::text,
      jsonb_build_object(
        'business_date', v_today,
        'closure_saved', false
      );
  elsif (v_day->'closure'->>'cash_variance')::numeric <> 0 then
    return query
    select
      v_today,
      'cash_variance:' || (v_day->'closure'->>'id'),
      'cash_variance'::text,
      'critical'::text,
      'Saved cash reconciliation has a variance'::text,
      'Counted cash differs from expected cash by NGN ' ||
        (v_day->'closure'->>'cash_variance') ||
        '. Review the saved closing record. Reviewing this action does not change that record.',
      jsonb_build_object(
        'closure_id', v_day->'closure'->>'id',
        'business_date', v_today,
        'expected_cash', v_day->'closure'->>'expected_cash',
        'counted_cash', v_day->'closure'->>'counted_cash',
        'cash_variance', v_day->'closure'->>'cash_variance'
      );
  end if;
end;
$forward_action$) then
    raise exception 'Exact forward Action Center source drift.';
  end if;
end;
$action_pin$;
-- Bounded metadata output only. No customer/auth/ledger rows are read.
select p.oid::regprocedure as function_identity, p.proowner::regrole as owner,
  p.proargnames, p.proconfig, p.proacl, md5(p.prosrc) as source_md5
from pg_proc p where p.oid in (
  to_regprocedure('public.confirm_opening_stock(uuid,uuid,date,jsonb)'),
  to_regprocedure('public.list_opening_stock_lot_metadata(uuid,uuid,integer)'),
  to_regprocedure('public.get_pharmacy_action_candidates(uuid)')) order by 1;
select c.conrelid::regclass as relation, c.contype, pg_get_constraintdef(c.oid,false) as definition
from pg_constraint c where c.conrelid in
  (to_regclass('public.opening_stock_receipts'),to_regclass('public.opening_stock_lots')) order by 1,2,3;
commit;
