-- Owner-only real team-member directory.
-- Uses a security-definer function so owners can read member emails from
-- auth.users without exposing a service-role key to the application.

create or replace function public.list_pharmacy_members(
  target_pharmacy_id uuid
)
returns table (
  user_id uuid,
  email text,
  role public.pharmacy_role,
  is_active boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    member.user_id,
    auth_user.email::text,
    member.role,
    member.is_active
  from public.pharmacy_members as member
  join auth.users as auth_user
    on auth_user.id = member.user_id
  where member.pharmacy_id = target_pharmacy_id
    and exists (
      select 1
      from public.pharmacy_members as caller
      join public.pharmacies as pharmacy
        on pharmacy.id = caller.pharmacy_id
      where caller.pharmacy_id = target_pharmacy_id
        and caller.user_id = auth.uid()
        and caller.role = 'owner'
        and caller.is_active = true
        and pharmacy.is_active = true
    )
  order by
    case member.role
      when 'owner' then 1
      when 'pharmacist' then 2
      when 'cashier' then 3
      when 'accountant' then 4
    end,
    auth_user.email;
$$;

revoke all on function public.list_pharmacy_members(uuid) from public;
revoke execute on function public.list_pharmacy_members(uuid) from anon;
grant execute on function public.list_pharmacy_members(uuid) to authenticated;
