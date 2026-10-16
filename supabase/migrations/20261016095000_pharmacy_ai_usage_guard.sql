-- Shared pharmacy-level AI request limits.
-- Stores counters only: no questions, answers or credentials.
create table public.pharmacy_ai_usage (
  pharmacy_id uuid not null references public.pharmacies(id)
    on delete restrict,
  business_date date not null,
  request_count integer not null check (request_count between 1 and 50),
  last_requested_at timestamptz not null,
  primary key (pharmacy_id, business_date)
);

alter table public.pharmacy_ai_usage enable row level security;

revoke all on public.pharmacy_ai_usage
  from public, anon, authenticated;

create or replace function public.reserve_pharmacy_ai_request(
  target_pharmacy_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz;
  v_today date;
  v_usage public.pharmacy_ai_usage%rowtype;
begin
  perform 1 from public.pharmacies as p
  where p.id = target_pharmacy_id and p.is_active = true
  for update;

  if not found or not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and m.role = 'owner'
  ) then
    raise exception 'Only an active owner can use Ask PharmaNudge.'
      using errcode = '42501';
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Lagos')::date;

  select u.* into v_usage
  from public.pharmacy_ai_usage as u
  where u.pharmacy_id = target_pharmacy_id
    and u.business_date = v_today;

  if found then
    if v_usage.request_count >= 50 then
      return 'daily_limit';
    end if;

    if v_now < v_usage.last_requested_at + interval '30 seconds' then
      return 'rate_limit';
    end if;

    update public.pharmacy_ai_usage as u
    set request_count = u.request_count + 1,
        last_requested_at = v_now
    where u.pharmacy_id = target_pharmacy_id
      and u.business_date = v_today;
  else
    insert into public.pharmacy_ai_usage (
      pharmacy_id, business_date, request_count, last_requested_at
    )
    values (target_pharmacy_id, v_today, 1, v_now);
  end if;

  return 'allowed';
end;
$$;

revoke all on function public.reserve_pharmacy_ai_request(uuid)
  from public, anon;

grant execute on function public.reserve_pharmacy_ai_request(uuid)
  to authenticated;
