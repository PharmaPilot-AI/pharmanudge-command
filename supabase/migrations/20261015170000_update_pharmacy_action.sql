-- Owner-authorized workflow updates with optimistic concurrency.
-- No operation changes stock, sales, expenses or closing records.
create or replace function public.update_pharmacy_action(
  target_pharmacy_id uuid,
  target_action_id uuid,
  expected_version bigint,
  action_command text,
  assigned_user_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_action public.pharmacy_actions%rowtype;
  v_version bigint;
begin
  if target_action_id is null
    or expected_version is null or expected_version < 1
    or action_command is null
    or action_command not in (
      'resolve', 'snooze', 'reopen', 'assign', 'unassign'
    )
    or (action_command = 'assign' and assigned_user_id is null)
    or (action_command <> 'assign' and assigned_user_id is not null)
  then
    raise exception 'Valid action update details are required.'
      using errcode = '22023';
  end if;

  -- Refresh also locks the pharmacy and verifies active owner access.
  perform public.refresh_pharmacy_actions(target_pharmacy_id);

  select a.* into v_action
  from public.pharmacy_actions as a
  where a.pharmacy_id = target_pharmacy_id
    and a.id = target_action_id
  for update;

  if not found then
    raise exception 'Action not found in this pharmacy.'
      using errcode = '22023';
  end if;

  if v_action.business_date <> v_today
    or v_action.source_active = false
  then
    raise exception 'This action is no longer current. Refresh the action queue.'
      using errcode = '22023';
  end if;

  if v_action.version <> expected_version then
    raise exception 'This action has changed. Refresh before updating it.'
      using errcode = '22023';
  end if;

  if action_command = 'assign' and not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = assigned_user_id
      and m.is_active = true
  ) then
    raise exception 'Choose an active member of this pharmacy.'
      using errcode = '22023';
  end if;

  if action_command = 'snooze' and v_today >= date '2100-12-31' then
    raise exception 'Snoozing beyond the supported date range is not available.'
      using errcode = '22023';
  end if;

  update public.pharmacy_actions as a
  set
    status = case
      when action_command = 'resolve' then 'resolved'
      when action_command = 'snooze' then 'snoozed'
      when action_command = 'reopen' then 'open'
      else a.status
    end,
    snoozed_until = case
      when action_command = 'snooze' then v_today + 1
      when action_command in ('resolve', 'reopen') then null
      else a.snoozed_until
    end,
    resolved_by = case
      when action_command = 'resolve' then v_actor
      when action_command in ('snooze', 'reopen') then null
      else a.resolved_by
    end,
    resolved_at = case
      when action_command = 'resolve' then clock_timestamp()
      when action_command in ('snooze', 'reopen') then null
      else a.resolved_at
    end,
    assignee_user_id = case
      when action_command = 'assign' then assigned_user_id
      when action_command = 'unassign' then null
      else a.assignee_user_id
    end,
    version = a.version + 1,
    updated_at = clock_timestamp()
  where a.pharmacy_id = target_pharmacy_id
    and a.id = target_action_id
  returning a.version into v_version;

  return v_version::text;
end;
$$;

revoke all on function public.update_pharmacy_action(
  uuid, uuid, bigint, text, uuid
) from public, anon;

grant execute on function public.update_pharmacy_action(
  uuid, uuid, bigint, text, uuid
) to authenticated;
