-- REVIEW-ONLY DRAFT. NOT EXECUTED. Requires separate target-specific approval.
-- Pin: docs/drafts/LOCAL_ONLY_get_pharmacy_business_day_status.sql, $$ body.
-- Never invoke the application RPC as an administrator to simulate membership.
-- Prerequisites: independently verified target, trusted function owner/baseline,
-- no concurrent DDL, stop-on-error client, PostgreSQL/Supabase compatibility review.
-- WRITE-CAPABLE rollback: drops only the new UUID RPC, never CASCADE.
-- This is NOT an execution instruction or migration-history cleanup.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
set local search_path = pg_catalog, pg_temp;

do $rollback$
declare
  v_oid oid := pg_catalog.to_regprocedure('public.get_pharmacy_business_day_status(uuid)');
  v_authenticated oid := (select oid from pg_catalog.pg_roles where rolname = 'authenticated');
  v_anon oid := (select oid from pg_catalog.pg_roles where rolname = 'anon');
  v_function pg_catalog.pg_proc%rowtype;
  v_expected_source constant text := $expected_source$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to access business-day status.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.pharmacy_members m
    join public.pharmacies p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active
      and p.is_active
      and m.role in ('owner', 'pharmacist', 'cashier', 'accountant')
  ) then
    raise exception 'Active pharmacy membership required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'business_date', v_today,
    'is_closed', exists (
      select 1 from public.daily_closures c
      where c.pharmacy_id = target_pharmacy_id
        and c.business_date = v_today
    )
  );
end;
$expected_source$;
begin
  if v_oid is null then
    raise exception 'Expected additive business-day RPC is absent; stop for review.';
  end if;
  if v_authenticated is null or v_anon is null then
    raise exception 'Expected Auth roles absent; stop for review.';
  end if;
  if (select count(*) from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_pharmacy_business_day_status') <> 1 then
    raise exception 'Unexpected overload/name drift; stop for review.';
  end if;

  select * into strict v_function from pg_catalog.pg_proc where oid = v_oid;
  if v_function.prokind <> 'f'
    or v_function.prolang <> (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
    or v_function.pronargs <> 1
    or v_function.proargtypes::text <> '2950' -- pg_catalog.uuid
    or v_function.proargnames is distinct from array['target_pharmacy_id']::text[]
    or v_function.proargmodes is not null
    or v_function.proallargtypes is not null
    or v_function.pronargdefaults <> 0
    or v_function.proargdefaults is not null
    or v_function.provariadic <> 0
    or v_function.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
    or v_function.proretset
    or not v_function.prosecdef
    or v_function.provolatile <> 's'
    or v_function.proparallel <> 'u'
    or v_function.proisstrict
    or v_function.proleakproof
    or v_function.proconfig is distinct from array['search_path=public, pg_temp']::text[]
    or v_function.prosrc is distinct from v_expected_source
  then
    raise exception 'Business-day RPC identity/source/security shape drift; stop for review.';
  end if;

  -- No owner is silently trusted here: independently qualify it before execution.
  -- Match the owner-relative ACL produced by the reviewed additive draft exactly.
  -- NULL proacl would reintroduce the default PUBLIC execution grant.
  if v_function.proowner in (v_authenticated, v_anon)
    or v_function.proacl is null
    or (select count(*) from pg_catalog.aclexplode(v_function.proacl)) <> 2
    or exists (
      select 1 from pg_catalog.aclexplode(v_function.proacl) a
      where a.grantee not in (v_function.proowner, v_authenticated)
        or a.grantor <> v_function.proowner
        or a.privilege_type <> 'EXECUTE' or a.is_grantable
    )
    or not exists (
      select 1 from pg_catalog.aclexplode(v_function.proacl) a
      where a.grantee = v_function.proowner and a.privilege_type = 'EXECUTE'
    )
    or not exists (
      select 1 from pg_catalog.aclexplode(v_function.proacl) a
      where a.grantee = v_authenticated and a.privilege_type = 'EXECUTE'
    )
    or pg_catalog.has_function_privilege(v_anon, v_oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege(v_authenticated, v_oid, 'EXECUTE')
  then
    raise exception 'Business-day RPC exact ACL/effective anon-authenticated access drift; stop for review.';
  end if;
  -- RESTRICT refuses dependent objects; any exception aborts this transaction.
  -- Static, schema-qualified identity: never a broad name scan or dynamic CASCADE.
  drop function public.get_pharmacy_business_day_status(uuid) restrict;
  if pg_catalog.to_regprocedure('public.get_pharmacy_business_day_status(uuid)') is not null then
    raise exception 'Rollback postcheck failed: UUID RPC still present.';
  end if;
end;
$rollback$;

commit;
