-- Owner-only saved action queue for one Lagos business day.
-- Reading does not generate or update actions.
create or replace function public.list_pharmacy_actions(
  target_pharmacy_id uuid,
  target_date date default (now() at time zone 'Africa/Lagos')::date
)
returns table (
  action_id uuid,
  business_date date,
  action_key text,
  action_kind text,
  severity text,
  title text,
  detail text,
  source_snapshot jsonb,
  source_active boolean,
  status text,
  snoozed_until date,
  assignee_user_id uuid,
  assignee_is_active boolean,
  resolved_by uuid,
  resolved_at timestamptz,
  version text,
  created_at timestamptz,
  updated_at timestamptz
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
      and m.is_active = true
      and p.is_active = true
      and m.role = 'owner'
  ) then
    raise exception 'Only an active owner can manage pharmacy actions.'
      using errcode = '42501';
  end if;

  if target_date is null or not isfinite(target_date)
    or target_date not between date '2000-01-01' and date '2100-12-31'
  then
    raise exception 'A valid action date between 2000 and 2100 is required.'
      using errcode = '22023';
  end if;

  return query
  select
    a.id,
    a.business_date,
    a.action_key,
    a.action_kind,
    a.severity,
    a.title,
    a.detail,
    a.source_snapshot,
    a.source_active,
    a.status,
    a.snoozed_until,
    a.assignee_user_id,
    exists (
      select 1 from public.pharmacy_members as assigned
      where assigned.pharmacy_id = a.pharmacy_id
        and assigned.user_id = a.assignee_user_id
        and assigned.is_active = true
    ),
    a.resolved_by,
    a.resolved_at,
    a.version::text,
    a.created_at,
    a.updated_at
  from public.pharmacy_actions as a
  where a.pharmacy_id = target_pharmacy_id
    and a.business_date = target_date
  order by
    a.source_active desc,
    case a.severity
      when 'critical' then 1
      when 'warning' then 2
      else 3
    end,
    a.created_at,
    a.id;
end;
$$;

revoke all on function public.list_pharmacy_actions(uuid, date)
  from public, anon;

grant execute on function public.list_pharmacy_actions(uuid, date)
  to authenticated;
