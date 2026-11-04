-- REVIEW-ONLY DRAFT. NOT EXECUTED. Requires separate target-specific approval.
-- Pin: docs/drafts/LOCAL_ONLY_get_pharmacy_business_day_status.sql, $$ body.
-- Never invoke the application RPC as an administrator to simulate membership.
-- Prerequisites: independently verified target, trusted function owner/baseline,
-- no concurrent DDL, stop-on-error client, PostgreSQL/Supabase compatibility review.
-- Catalog inspection only: no application/Auth/customer data reads or RPC calls.
begin transaction read only;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
set local search_path = pg_catalog, pg_temp;

-- Inspect all named overloads; the assertion below requires only the UUID RPC.
select p.oid::regprocedure as identity,
       pg_get_userbyid(p.proowner) as owner,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_arguments(p.oid) as arguments_with_defaults,
       pg_get_function_result(p.oid) as result,
       l.lanname as language, p.prokind, p.prosecdef, p.provolatile,
       p.proparallel, p.proisstrict, p.proleakproof, p.proconfig,
       p.proacl as explicit_acl,
       pg_get_functiondef(p.oid) as reviewed_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public' and p.proname = 'get_pharmacy_business_day_status'
order by p.oid;

-- Complete effective ACL expansion including PUBLIC (OID 0), not role-name sampling.
select p.oid::regprocedure as identity,
       pg_get_userbyid(a.grantor) as grantor,
       case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,
       a.privilege_type, a.is_grantable,
       p.proacl is null as using_default_acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where n.nspname = 'public' and p.proname = 'get_pharmacy_business_day_status'
order by p.oid, a.grantor, a.grantee, a.privilege_type, a.is_grantable;

-- Direct role edges for review, NOT a complete transitive or SET-role proof.
select pg_get_userbyid(m.roleid) as granted_role,
       pg_get_userbyid(m.member) as member_role, m.admin_option
from pg_auth_members m
where m.roleid in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
   or m.member in (select oid from pg_roles where rolname in ('anon', 'authenticated'))
order by m.roleid, m.member;

-- Exact source pin covers the membership join, auth.uid(), all four roles,
-- both active flags, 42501 denial, server Lagos date, scoped closure EXISTS,
-- and the output-only business_date/is_closed JSONB contract.
do $verify$
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
  raise notice 'Catalog/source/ACL assertions passed; native member authorization remains UNQUALIFIED.';
end;
$verify$;

rollback;
