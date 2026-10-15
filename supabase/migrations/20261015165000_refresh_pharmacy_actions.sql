-- Explicit synchronization of today's action queue.
-- Call through a POST server function, not a GET request.
create or replace function public.refresh_pharmacy_actions(
  target_pharmacy_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_candidates jsonb;
  v_count integer;
begin
  -- Serialize with other pharmacy commands and membership changes.
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
    raise exception 'Only an active owner can manage pharmacy actions.'
      using errcode = '42501';
  end if;

  -- Materialize the evidence once for this synchronization.
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
  into v_candidates
  from public.get_pharmacy_action_candidates(target_pharmacy_id) as c;

  -- Keep historical rows, but mark disappeared conditions as inactive.
  update public.pharmacy_actions as a
  set source_active = false,
      version = a.version + 1,
      updated_at = clock_timestamp()
  where a.pharmacy_id = target_pharmacy_id
    and a.business_date = v_today
    and a.source_active = true
    and not exists (
      select 1
      from jsonb_array_elements(v_candidates) as c(value)
      where c.value->>'action_key' = a.action_key
    );

  insert into public.pharmacy_actions as existing (
    pharmacy_id, business_date, action_key,
    action_kind, severity, title, detail, source_snapshot
  )
  select
    target_pharmacy_id, c.business_date, c.action_key,
    c.action_kind, c.severity, c.title, c.detail, c.source_snapshot
  from jsonb_to_recordset(v_candidates) as c(
    business_date date,
    action_key text,
    action_kind text,
    severity text,
    title text,
    detail text,
    source_snapshot jsonb
  )
  on conflict (pharmacy_id, business_date, action_key)
  do update set
    action_kind = excluded.action_kind,
    severity = excluded.severity,
    title = excluded.title,
    detail = excluded.detail,
    source_snapshot = excluded.source_snapshot,
    source_active = true,
    status = 'open',
    snoozed_until = null,
    resolved_by = null,
    resolved_at = null,
    version = existing.version + 1,
    updated_at = clock_timestamp()
  where existing.source_active = false
    or existing.source_snapshot is distinct from excluded.source_snapshot
    or existing.title is distinct from excluded.title
    or existing.detail is distinct from excluded.detail
    or existing.severity is distinct from excluded.severity
    or existing.action_kind is distinct from excluded.action_kind;

  -- Repeated refreshes with unchanged evidence preserve workflow state.
  select count(*)::integer into v_count
  from public.pharmacy_actions as a
  where a.pharmacy_id = target_pharmacy_id
    and a.business_date = v_today
    and a.source_active = true;

  return v_count;
end;
$$;

revoke all on function public.refresh_pharmacy_actions(uuid)
  from public, anon;

grant execute on function public.refresh_pharmacy_actions(uuid)
  to authenticated;
