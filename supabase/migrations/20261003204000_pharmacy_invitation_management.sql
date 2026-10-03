-- Owner-only invitation listing and cancellation.
create or replace function public.list_pharmacy_invitations(
  target_pharmacy_id uuid
)
returns table (
  id uuid,
  email text,
  role public.pharmacy_role,
  status text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.pharmacy_members as m
    join public.pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.is_active = true
      and p.is_active = true
  ) then
    raise exception 'Only an active pharmacy owner can view invitations.'
      using errcode = '42501';
  end if;

  return query
  select i.id, i.email, i.role,
    case
      when i.status = 'pending' and i.expires_at <= now() then 'expired'
      else i.status
    end,
    i.expires_at, i.created_at
  from public.pharmacy_invitations as i
  where i.pharmacy_id = target_pharmacy_id
  order by i.created_at desc, i.id;
end;
$$;

create or replace function public.cancel_pharmacy_invitation(
  target_pharmacy_id uuid,
  target_invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelled_id uuid;
begin
  if target_pharmacy_id is null or target_invitation_id is null then
    raise exception 'Pharmacy and invitation are required.'
      using errcode = '22023';
  end if;

  -- Same locking order as creation and future acceptance.
  perform 1 from public.pharmacies as p
  where p.id = target_pharmacy_id and p.is_active = true
  for update;

  if not found then
    raise exception 'Active pharmacy not found.';
  end if;

  if not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.role = 'owner'
      and m.is_active = true
  ) then
    raise exception 'Only an active pharmacy owner can cancel invitations.'
      using errcode = '42501';
  end if;

  update public.pharmacy_invitations as i
  set status = 'cancelled'
  where i.id = target_invitation_id
    and i.pharmacy_id = target_pharmacy_id
    and i.status = 'pending'
  returning i.id into v_cancelled_id;

  if not found then
    raise exception 'Pending invitation not found.';
  end if;

  return v_cancelled_id;
end;
$$;

revoke all on function public.list_pharmacy_invitations(uuid)
  from public, anon;
grant execute on function public.list_pharmacy_invitations(uuid)
  to authenticated;

revoke all on function public.cancel_pharmacy_invitation(uuid, uuid)
  from public, anon;
grant execute on function public.cancel_pharmacy_invitation(uuid, uuid)
  to authenticated;
