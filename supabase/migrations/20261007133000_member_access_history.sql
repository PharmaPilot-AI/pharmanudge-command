-- Owner-only access to the latest 50 member access changes.
create or replace function public.list_pharmacy_member_audit(
  target_pharmacy_id uuid
)
returns table (
  id uuid,
  actor_user_id uuid,
  actor_email text,
  target_user_id uuid,
  target_email text,
  old_role public.pharmacy_role,
  new_role public.pharmacy_role,
  old_is_active boolean,
  new_is_active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.pharmacy_members as m
    join public.pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.is_active = true
      and p.is_active = true
  ) then
    raise exception 'Only an active pharmacy owner can view access history.'
      using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.actor_user_id,
    actor.email::text,
    a.target_user_id,
    recipient.email::text,
    a.old_role,
    a.new_role,
    a.old_is_active,
    a.new_is_active,
    a.created_at
  from public.pharmacy_member_audit as a
  left join auth.users as actor on actor.id = a.actor_user_id
  left join auth.users as recipient on recipient.id = a.target_user_id
  where a.pharmacy_id = target_pharmacy_id
  order by a.created_at desc, a.id desc
  limit 50;
end;
$$;

revoke all on function public.list_pharmacy_member_audit(uuid)
  from public, anon;

grant execute on function public.list_pharmacy_member_audit(uuid)
  to authenticated;
