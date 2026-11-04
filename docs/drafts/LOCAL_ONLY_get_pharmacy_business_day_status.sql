-- LOCAL-ONLY MIGRATION DRAFT — NOT APPROVED FOR APPLICATION.
-- Intentionally outside supabase/migrations. Never executed or applied here.
-- Requires separate review/authorization and runtime DB security qualification.
-- The app fails closed until this RPC is approved and applied to its database.

begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';

-- Additive only: never overwrite a pre-existing function or overload.
do $preflight$
begin
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_pharmacy_business_day_status'
  ) then
    raise exception 'Business-day status function already exists; stop for review.';
  end if;
end;
$preflight$;

create function public.get_pharmacy_business_day_status(target_pharmacy_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.get_pharmacy_business_day_status(uuid) from public, anon;
grant execute on function public.get_pharmacy_business_day_status(uuid) to authenticated;

-- Fail atomically if target-specific default function privileges differ from
-- this narrow reviewed ACL. Never edit default privileges or other objects.
do $acl_guard$
declare
  v_function pg_catalog.pg_proc%rowtype;
  v_authenticated oid := 'authenticated'::pg_catalog.regrole;
  v_anon oid := 'anon'::pg_catalog.regrole;
begin
  select * into strict v_function from pg_catalog.pg_proc
  where oid = 'public.get_pharmacy_business_day_status(uuid)'::pg_catalog.regprocedure;
  if v_function.proowner in (v_authenticated, v_anon)
    or v_function.proacl is null
    or (select count(*) from pg_catalog.aclexplode(v_function.proacl)) <> 2
    or exists (
      select 1 from pg_catalog.aclexplode(v_function.proacl) a
      where a.grantee not in (v_function.proowner, v_authenticated)
        or a.grantor <> v_function.proowner
        or a.privilege_type <> 'EXECUTE' or a.is_grantable
    )
    or pg_catalog.has_function_privilege(v_anon, v_function.oid, 'EXECUTE')
    or not pg_catalog.has_function_privilege(v_authenticated, v_function.oid, 'EXECUTE')
  then
    raise exception 'Unexpected new-function ACL; stop for target-specific review.';
  end if;
end;
$acl_guard$;
commit;
