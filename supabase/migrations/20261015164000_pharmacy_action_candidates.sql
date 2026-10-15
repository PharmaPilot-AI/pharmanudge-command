-- Current action candidates derived from authorized pharmacy records.
-- This function reads records only; it does not change the action queue.

create or replace function public.get_pharmacy_action_candidates(
  target_pharmacy_id uuid
)
returns table (
  business_date date,
  action_key text,
  action_kind text,
  severity text,
  title text,
  detail text,
  source_snapshot jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_day jsonb;
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

  v_day := public.get_pharmacy_day_summary(target_pharmacy_id, v_today);

  return query
  select
    v_today,
    'out_of_stock:' || i.product_id::text,
    'out_of_stock'::text,
    'critical'::text,
    left(i.product_name, 220) || ' has no unexpired stock',
    'No unexpired stock is available. Review inventory and confirm purchasing needs before reordering.'::text,
    jsonb_build_object(
      'product_id', i.product_id,
      'product_name', i.product_name,
      'available_quantity', i.available_quantity,
      'base_unit_label', i.base_unit_label,
      'as_of_date', v_today
    )
  from public.list_pharmacy_inventory(target_pharmacy_id) as i
  where i.is_active = true
    and i.available_quantity::numeric <= 0;

  return query
  select
    v_today,
    case when b.expiry_date <= v_today
      then 'expired_batch:' else 'expiring_batch:'
    end || b.batch_id::text,
    case when b.expiry_date <= v_today
      then 'expired_batch' else 'expiring_batch'
    end,
    case when b.expiry_date <= v_today
      then 'critical' else 'warning'
    end,
    left(b.product_name, 180) ||
      case when b.expiry_date <= v_today
        then ' has expired stock'
        else ' has stock expiring within 30 days'
      end,
    'Batch ' || left(b.batch_number, 100) ||
      ' expires on ' || b.expiry_date::text ||
      '. Remaining quantity: ' || b.remaining_quantity ||
      ' ' || left(b.base_unit_label, 100) ||
      case when b.expiry_date <= v_today
        then '. Review and separate it from saleable stock.'
        else '. Review the batch and plan an appropriate stock action.'
      end,
    jsonb_build_object(
      'batch_id', b.batch_id,
      'product_id', b.product_id,
      'product_name', b.product_name,
      'batch_number', b.batch_number,
      'expiry_date', b.expiry_date,
      'remaining_quantity', b.remaining_quantity,
      'base_unit_label', b.base_unit_label,
      'stock_value', b.stock_value,
      'as_of_date', v_today
    )
  from public.list_pharmacy_stock_batches(target_pharmacy_id) as b
  where b.remaining_quantity::numeric > 0
    and b.expiry_date <= v_today + 30;

  if v_day->'closure' = 'null'::jsonb then
    return query
    select
      v_today,
      'unreconciled_day'::text,
      'unreconciled_day'::text,
      'info'::text,
      'Today has no saved cash reconciliation'::text,
      'The business day is open. Review opening cash and count the drawer when trading is finished. This is a reminder, not evidence of a cash shortage.'::text,
      jsonb_build_object(
        'business_date', v_today,
        'closure_saved', false
      );
  elsif (v_day->'closure'->>'cash_variance')::numeric <> 0 then
    return query
    select
      v_today,
      'cash_variance:' || (v_day->'closure'->>'id'),
      'cash_variance'::text,
      'critical'::text,
      'Saved cash reconciliation has a variance'::text,
      'Counted cash differs from expected cash by NGN ' ||
        (v_day->'closure'->>'cash_variance') ||
        '. Review the saved closing record. Reviewing this action does not change that record.',
      jsonb_build_object(
        'closure_id', v_day->'closure'->>'id',
        'business_date', v_today,
        'expected_cash', v_day->'closure'->>'expected_cash',
        'counted_cash', v_day->'closure'->>'counted_cash',
        'cash_variance', v_day->'closure'->>'cash_variance'
      );
  end if;
end;
$$;

revoke all on function public.get_pharmacy_action_candidates(uuid)
  from public, anon;

grant execute on function public.get_pharmacy_action_candidates(uuid)
  to authenticated;
