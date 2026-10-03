-- Pending invitations; membership is granted by a later acceptance workflow.
create table public.pharmacy_invitations (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete cascade,
  email text not null,
  role public.pharmacy_role not null,
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_email_normalized check (
    email = lower(btrim(email))
    and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint invitation_staff_role check (
    role in ('pharmacist', 'cashier', 'accountant')
  ),
  constraint invitation_status check (
    status in ('pending', 'accepted', 'cancelled', 'expired')
  ),
  constraint invitation_expiry check (expires_at > created_at)
);

create unique index pharmacy_invitations_pending_email_key
  on public.pharmacy_invitations(pharmacy_id, email)
  where status = 'pending';

create trigger pharmacy_invitations_set_updated_at
  before update on public.pharmacy_invitations
  for each row execute function public.set_updated_at();

alter table public.pharmacy_invitations enable row level security;

-- Access is through explicitly authorized functions, not direct table writes.
revoke all on public.pharmacy_invitations from anon, authenticated;

create or replace function public.create_pharmacy_invitation(
  target_pharmacy_id uuid,
  invitation_email text,
  invitation_role public.pharmacy_role
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(btrim(invitation_email));
  v_invitation_id uuid;
begin
  if target_pharmacy_id is null
    or v_email is null
    or length(v_email) not between 3 and 254
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or invitation_role is null
    or invitation_role not in ('pharmacist', 'cashier', 'accountant')
  then
    raise exception 'A valid email and staff role are required.'
      using errcode = '22023';
  end if;

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
    raise exception 'Only an active pharmacy owner can invite members.'
      using errcode = '42501';
  end if;

  -- Existing members must be managed through the member-management workflow.
  if exists (
    select 1 from public.pharmacy_members as m
    join auth.users as u on u.id = m.user_id
    where m.pharmacy_id = target_pharmacy_id
      and lower(btrim(u.email)) = v_email
  ) then
    raise exception 'This email already belongs to a pharmacy member.';
  end if;

  update public.pharmacy_invitations as i
  set status = 'expired'
  where i.pharmacy_id = target_pharmacy_id
    and i.email = v_email
    and i.status = 'pending'
    and i.expires_at <= now();

  if exists (
    select 1 from public.pharmacy_invitations as i
    where i.pharmacy_id = target_pharmacy_id
      and i.email = v_email and i.status = 'pending'
  ) then
    raise exception 'A pending invitation already exists for this email.';
  end if;

  insert into public.pharmacy_invitations(
    pharmacy_id, email, role, invited_by
  )
  values (
    target_pharmacy_id, v_email, invitation_role, auth.uid()
  )
  returning id into v_invitation_id;

  return v_invitation_id;
end;
$$;

revoke all on function public.create_pharmacy_invitation(
  uuid, text, public.pharmacy_role
) from public, anon;

grant execute on function public.create_pharmacy_invitation(
  uuid, text, public.pharmacy_role
) to authenticated;
