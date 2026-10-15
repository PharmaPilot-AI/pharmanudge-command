-- Atomic, duplicate-safe daily closing.
create or replace function public.close_pharmacy_day(
  target_pharmacy_id uuid,
  operation_id uuid,
  target_date date,
  opening_cash_amount numeric,
  counted_cash_amount numeric,
  closure_notes text,
  reviewed_totals jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_notes text := btrim(closure_notes);
  v_existing public.daily_closures%rowtype;
  v_payload jsonb;
  v_totals jsonb;
  v_now timestamptz;
  v_today date;
  v_start timestamptz;
  v_end timestamptz;
  v_cash_sales numeric;
  v_transfer_sales numeric;
  v_card_sales numeric;
  v_cash_expenses numeric;
  v_transfer_expenses numeric;
  v_card_expenses numeric;
  v_sale_count bigint;
  v_expense_count bigint;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'Please sign in to close the day.'
      using errcode = '42501';
  end if;

  if target_pharmacy_id is null or operation_id is null
    or target_date is null or not isfinite(target_date)
    or target_date not between date '2000-01-01' and date '2100-12-31'
    or v_notes is null or length(v_notes) > 1000
    or reviewed_totals is null
    or jsonb_typeof(reviewed_totals) <> 'object'
  then
    raise exception 'Valid closing details are required.'
      using errcode = '22023';
  end if;

  if opening_cash_amount is null
    or opening_cash_amount < 0
    or opening_cash_amount >= 10000000000000000
    or opening_cash_amount <> round(opening_cash_amount, 2)
    or counted_cash_amount is null
    or counted_cash_amount < 0
    or counted_cash_amount >= 10000000000000000
    or counted_cash_amount <> round(counted_cash_amount, 2)
  then
    raise exception 'Cash amounts must be non-negative with at most two decimal places.'
      using errcode = '22023';
  end if;

  perform 1 from public.pharmacies as p
  where p.id = target_pharmacy_id and p.is_active = true
  for update;

  if not found then
    raise exception 'Active pharmacy not found.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = v_actor
      and m.is_active = true
      and m.role in ('owner', 'accountant')
  ) then
    raise exception 'Only an active owner or accountant can close the day.'
      using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'business_date', target_date,
    'opening_cash', opening_cash_amount,
    'counted_cash', counted_cash_amount,
    'notes', v_notes,
    'reviewed_totals', reviewed_totals
  );

  select c.* into v_existing
  from public.daily_closures as c
  where c.pharmacy_id = target_pharmacy_id
    and c.client_operation_id = operation_id;

  if found then
    if v_existing.closed_by <> v_actor
      or v_existing.request_payload <> v_payload
    then
      raise exception 'This submission reference was already used for a different closing.'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Lagos')::date;

  if target_date <> v_today then
    raise exception 'Only the current Lagos business day can be closed.'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.daily_closures as c
    where c.pharmacy_id = target_pharmacy_id
      and c.business_date = target_date
  ) then
    raise exception 'This business day is already closed.'
      using errcode = '22023';
  end if;

  v_start := target_date::timestamp at time zone 'Africa/Lagos';
  v_end := (target_date + 1)::timestamp at time zone 'Africa/Lagos';

  select
    coalesce(sum(s.total) filter (where s.payment_method = 'cash'), 0),
    coalesce(sum(s.total) filter (where s.payment_method = 'transfer'), 0),
    coalesce(sum(s.total) filter (where s.payment_method = 'pos_card'), 0),
    count(*)
  into v_cash_sales, v_transfer_sales, v_card_sales, v_sale_count
  from public.sales as s
  where s.pharmacy_id = target_pharmacy_id
    and s.sold_at >= v_start and s.sold_at < v_end;

  select
    coalesce(sum(e.amount) filter (where e.payment_source = 'cash'), 0),
    coalesce(sum(e.amount) filter (where e.payment_source = 'transfer'), 0),
    coalesce(sum(e.amount) filter (where e.payment_source = 'pos_card'), 0),
    count(*)
  into v_cash_expenses, v_transfer_expenses, v_card_expenses, v_expense_count
  from public.expenses as e
  where e.pharmacy_id = target_pharmacy_id
    and e.spent_at >= v_start and e.spent_at < v_end;

  if greatest(
    v_cash_sales, v_transfer_sales, v_card_sales,
    v_cash_expenses, v_transfer_expenses, v_card_expenses
  ) >= 10000000000000000 then
    raise exception 'Daily totals exceed the supported closing amount.'
      using errcode = '22023';
  end if;

  v_totals := jsonb_build_object(
    'cash_sales', round(v_cash_sales, 2)::text,
    'transfer_sales', round(v_transfer_sales, 2)::text,
    'card_sales', round(v_card_sales, 2)::text,
    'cash_expenses', round(v_cash_expenses, 2)::text,
    'transfer_expenses', round(v_transfer_expenses, 2)::text,
    'card_expenses', round(v_card_expenses, 2)::text,
    'sale_count', v_sale_count::text,
    'expense_count', v_expense_count::text
  );

  if reviewed_totals <> v_totals then
    raise exception 'Daily totals have changed. Refresh and review before closing.'
      using errcode = '22023';
  end if;

  insert into public.daily_closures (
    pharmacy_id, business_date, client_operation_id, closed_by,
    opening_cash, counted_cash,
    cash_sales, transfer_sales, card_sales,
    cash_expenses, transfer_expenses, card_expenses,
    sale_count, expense_count, notes, request_payload, closed_at
  )
  values (
    target_pharmacy_id, target_date, operation_id, v_actor,
    opening_cash_amount, counted_cash_amount,
    v_cash_sales, v_transfer_sales, v_card_sales,
    v_cash_expenses, v_transfer_expenses, v_card_expenses,
    v_sale_count, v_expense_count, v_notes, v_payload, v_now
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.close_pharmacy_day(
  uuid, uuid, date, numeric, numeric, text, jsonb
) from public, anon;

grant execute on function public.close_pharmacy_day(
  uuid, uuid, date, numeric, numeric, text, jsonb
) to authenticated;
