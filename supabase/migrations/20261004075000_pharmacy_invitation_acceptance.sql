-- Verified-recipient acceptance with atomic membership creation.
alter table public.pharmacy_invitations
  add column accepted_by uuid references auth.users(id),
  add column accepted_at timestamptz,
  add constraint invitation_acceptance_audit check (
    (accepted_by is null and accepted_at is null)
    or (
      accepted_by is not null
      and accepted_at is not null
      and status = 'accepted'
    )
  );

create or replace function public.accept_pharmacy_invitation(
  target_invitation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_pharmacy_id uuid;
  v_invitation public.pharmacy_invitations%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please sign in to accept an invitation.'
      using errcode = '42501';
  end if;

  if target_invitation_id is null then
    raise exception 'An invitation is required.'
      using errcode = '22023';
  end if;

  -- Discover the pharmacy, then follow the same pharmacy-first lock order
  -- as invitation creation and cancellation.
  select i.pharmacy_id into v_pharmacy_id
  from public.pharmacy_invitations as i
  where i.id = target_invitation_id;

  if not found then
    raise exception 'This invitation is unavailable or has expired.';
  end if;

  perform 1 from public.pharmacies as p
  where p.id = v_pharmacy_id and p.is_active = true
  for update;

  if not found then
    raise exception 'This invitation is unavailable or has expired.';
  end if;

  -- Serialize acceptance across pharmacies for this recipient.
  -- NO KEY UPDATE remains compatible with foreign-key key-share locks.
  select lower(btrim(u.email)) into v_email
  from auth.users as u
  where u.id = v_user_id
    and u.email is not null
    and u.email_confirmed_at is not null
    and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  for no key update;

  if not found then
    raise exception 'A verified email account is required to accept an invitation.'
      using errcode = '42501';
  end if;

  select i.* into v_invitation
  from public.pharmacy_invitations as i
  where i.id = target_invitation_id
    and i.pharmacy_id = v_pharmacy_id
  for update;

  if not found then
    raise exception 'This invitation is unavailable or has expired.';
  end if;

  if v_invitation.email <> v_email then
    raise exception 'Sign in with the email address that received this invitation.'
      using errcode = '42501';
  end if;

  if v_invitation.status <> 'pending'
    or v_invitation.expires_at <= clock_timestamp()
  then
    raise exception 'This invitation is unavailable or has expired.';
  end if;

  -- An invitation cannot grant access after its inviter loses owner access.
  if not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = v_pharmacy_id
      and m.user_id = v_invitation.invited_by
      and m.role = 'owner'
      and m.is_active = true
  ) then
    raise exception 'This invitation is unavailable or has expired.';
  end if;

  -- Do not reactivate or overwrite an existing member through acceptance.
  if exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = v_pharmacy_id and m.user_id = v_user_id
  ) then
    raise exception 'You already have a membership in this pharmacy.';
  end if;

  -- The application currently requires a single active membership.
  if exists (
    select 1 from public.pharmacy_members as m
    where m.user_id = v_user_id and m.is_active = true
  ) then
    raise exception 'You already have an active pharmacy membership.';
  end if;

  insert into public.pharmacy_members (
    pharmacy_id, user_id, role, is_active
  )
  values (
    v_pharmacy_id, v_user_id, v_invitation.role, true
  );

  update public.pharmacy_invitations as i
  set status = 'accepted',
      accepted_by = v_user_id,
      accepted_at = clock_timestamp()
  where i.id = target_invitation_id;

  return v_pharmacy_id;
end;
$$;

revoke all on function public.accept_pharmacy_invitation(uuid)
  from public, anon;

grant execute on function public.accept_pharmacy_invitation(uuid)
  to authenticated;
