-- Authorized daily totals and saved reconciliation.
-- Decimal strings preserve exact amounts across the application boundary.
create or replace function public.get_pharmacy_day_summary(
  target_pharmacy_id uuid,
  target_date date default (now() at time zone 'Africa/Lagos')::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.pharmacy_members as m
    join public.pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.is_active = true
      and m.role in ('owner', 'accountant')
  ) then
    raise exception 'Only an active owner or accountant can view daily reconciliation.'
      using errcode = '42501';
  end if;

  if target_date is null or not isfinite(target_date)
    or target_date not between date '2000-01-01' and date '2100-12-31'
  then
    raise exception 'A valid business date between 2000 and 2100 is required.'
      using errcode = '22023';
  end if;

  v_start := target_date::timestamp at time zone 'Africa/Lagos';
  v_end := (target_date + 1)::timestamp at time zone 'Africa/Lagos';

  with sale_totals as (
    select
      round(coalesce(sum(s.total) filter (
        where s.payment_method = 'cash'
      ), 0), 2)::text as cash_sales,
      round(coalesce(sum(s.total) filter (
        where s.payment_method = 'transfer'
      ), 0), 2)::text as transfer_sales,
      round(coalesce(sum(s.total) filter (
        where s.payment_method = 'pos_card'
      ), 0), 2)::text as card_sales,
      count(*)::text as sale_count
    from public.sales as s
    where s.pharmacy_id = target_pharmacy_id
      and s.sold_at >= v_start and s.sold_at < v_end
  ),
  expense_totals as (
    select
      round(coalesce(sum(e.amount) filter (
        where e.payment_source = 'cash'
      ), 0), 2)::text as cash_expenses,
      round(coalesce(sum(e.amount) filter (
        where e.payment_source = 'transfer'
      ), 0), 2)::text as transfer_expenses,
      round(coalesce(sum(e.amount) filter (
        where e.payment_source = 'pos_card'
      ), 0), 2)::text as card_expenses,
      count(*)::text as expense_count
    from public.expenses as e
    where e.pharmacy_id = target_pharmacy_id
      and e.spent_at >= v_start and e.spent_at < v_end
  )
  select jsonb_build_object(
    'business_date', target_date,
    'totals', jsonb_build_object(
      'cash_sales', s.cash_sales,
      'transfer_sales', s.transfer_sales,
      'card_sales', s.card_sales,
      'cash_expenses', e.cash_expenses,
      'transfer_expenses', e.transfer_expenses,
      'card_expenses', e.card_expenses,
      'sale_count', s.sale_count,
      'expense_count', e.expense_count
    ),
    'closure', (
      select jsonb_build_object(
        'id', c.id,
        'business_date', c.business_date,
        'closed_by', c.closed_by,
        'closed_by_email', (
          select u.email::text
          from auth.users as u
          where u.id = c.closed_by
        ),
        'closed_at', c.closed_at,
        'opening_cash', c.opening_cash::text,
        'counted_cash', c.counted_cash::text,
        'expected_cash', c.expected_cash::text,
        'cash_variance', c.cash_variance::text,
        'cash_sales', c.cash_sales::text,
        'transfer_sales', c.transfer_sales::text,
        'card_sales', c.card_sales::text,
        'cash_expenses', c.cash_expenses::text,
        'transfer_expenses', c.transfer_expenses::text,
        'card_expenses', c.card_expenses::text,
        'sale_count', c.sale_count::text,
        'expense_count', c.expense_count::text,
        'notes', c.notes
      )
      from public.daily_closures as c
      where c.pharmacy_id = target_pharmacy_id
        and c.business_date = target_date
    )
  ) into v_result
  from sale_totals as s cross join expense_totals as e;

  return v_result;
end;
$$;

revoke all on function public.get_pharmacy_day_summary(uuid, date)
  from public, anon;

grant execute on function public.get_pharmacy_day_summary(uuid, date)
  to authenticated;
