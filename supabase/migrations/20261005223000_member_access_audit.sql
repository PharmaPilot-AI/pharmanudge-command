-- Audit successful member role and activation changes.
-- UUIDs are retained without cascading foreign keys to preserve history.

create table public.pharmacy_member_audit (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null,
  actor_user_id uuid not null,
  target_user_id uuid not null,
  action text not null default 'member_access_updated'
    check (action = 'member_access_updated'),
  old_role public.pharmacy_role not null,
  new_role public.pharmacy_role not null,
  old_is_active boolean not null,
  new_is_active boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint member_audit_has_change check (
    old_role <> new_role or old_is_active <> new_is_active
  )
);

create index pharmacy_member_audit_pharmacy_created_idx
  on public.pharmacy_member_audit (pharmacy_id, created_at desc, id desc);

alter table public.pharmacy_member_audit enable row level security;
revoke all on public.pharmacy_member_audit from public, anon, authenticated;

-- Correct final-owner protection: avoid the PostgreSQL CURRENT_ROLE name.
-- Preserve owner authorization, pharmacy locking, and execution grants.

-- Owner-only pharmacy member role and activation management.
-- Serializes changes per pharmacy and prevents removal of the last active owner.

create or replace function public.update_pharmacy_member(
  target_pharmacy_id uuid,
  target_user_id uuid,
  new_role public.pharmacy_role,
  new_is_active boolean
)
returns table (
  user_id uuid,
  email text,
  role public.pharmacy_role,
  is_active boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_member_role public.pharmacy_role;
  v_member_is_active boolean;
  v_active_owner_count integer;
begin
  if target_pharmacy_id is null
    or target_user_id is null
    or new_role is null
    or new_is_active is null
  then
    raise exception 'All member update fields are required.';
  end if;

  -- Lock the pharmacy row so owner changes for this pharmacy are serialized.
  perform 1
  from public.pharmacies as pharmacy
  where pharmacy.id = target_pharmacy_id
    and pharmacy.is_active = true
  for update;

  if not found then
    raise exception 'Active pharmacy not found.';
  end if;

  if not exists (
    select 1
    from public.pharmacy_members as caller
    where caller.pharmacy_id = target_pharmacy_id
      and caller.user_id = auth.uid()
      and caller.role = 'owner'
      and caller.is_active = true
  ) then
    raise exception 'Only an active pharmacy owner can manage members.'
      using errcode = '42501';
  end if;

  select member.role, member.is_active
  into v_member_role, v_member_is_active
  from public.pharmacy_members as member
  where member.pharmacy_id = target_pharmacy_id
    and member.user_id = target_user_id
  for update;

  if not found then
    raise exception 'Pharmacy member not found.';
  end if;

  if v_member_role = 'owner'
    and v_member_is_active = true
    and (new_role <> 'owner' or new_is_active = false)
  then
    select count(*)
    into v_active_owner_count
    from public.pharmacy_members as member
    where member.pharmacy_id = target_pharmacy_id
      and member.role = 'owner'
      and member.is_active = true;

    if v_active_owner_count <= 1 then
      raise exception 'The last active owner cannot be demoted or deactivated.'
        using errcode = '23514';
    end if;
  end if;

  if v_member_role is distinct from new_role
    or v_member_is_active is distinct from new_is_active
  then
    insert into public.pharmacy_member_audit (
      pharmacy_id, actor_user_id, target_user_id,
      old_role, new_role, old_is_active, new_is_active
    )
    values (
      target_pharmacy_id, auth.uid(), target_user_id,
      v_member_role, new_role, v_member_is_active, new_is_active
    );
  end if;

  update public.pharmacy_members as member
  set
    role = new_role,
    is_active = new_is_active
  where member.pharmacy_id = target_pharmacy_id
    and member.user_id = target_user_id;

  return query
  select
    member.user_id,
    auth_user.email::text,
    member.role,
    member.is_active
  from public.pharmacy_members as member
  join auth.users as auth_user
    on auth_user.id = member.user_id
  where member.pharmacy_id = target_pharmacy_id
    and member.user_id = target_user_id;
end;
$$;

revoke all on function public.update_pharmacy_member(
  uuid,
  uuid,
  public.pharmacy_role,
  boolean
) from public;

revoke execute on function public.update_pharmacy_member(
  uuid,
  uuid,
  public.pharmacy_role,
  boolean
) from anon;

grant execute on function public.update_pharmacy_member(
  uuid,
  uuid,
  public.pharmacy_role,
  boolean
) to authenticated;
