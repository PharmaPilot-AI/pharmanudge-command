-- Pharmacy-scoped financial reporting from real transactions.
create or replace function public.get_pharmacy_financial_summary(
  target_pharmacy_id uuid,
  report_period text default 'today'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_start_date date;
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
    raise exception 'Only an active owner or accountant can view financial reports.'
      using errcode = '42501';
  end if;

  if report_period is null
    or report_period not in ('today', 'week', 'month')
  then
    raise exception 'Choose today, week or month for the report.'
      using errcode = '22023';
  end if;

  v_start_date := case report_period
    when 'today' then v_today
    when 'week' then date_trunc('week', v_today::timestamp)::date
    when 'month' then date_trunc('month', v_today::timestamp)::date
  end;

  v_start := v_start_date::timestamp at time zone 'Africa/Lagos';
  v_end := (v_today + 1)::timestamp at time zone 'Africa/Lagos';

  with period_sales as (
    select s.id, s.product_revenue, s.service_revenue, s.total,
      s.payment_method
    from public.sales as s
    where s.pharmacy_id = target_pharmacy_id
      and s.sold_at >= v_start and s.sold_at < v_end
  ),
  revenue as (
    select
      coalesce(sum(s.product_revenue), 0) as product_revenue,
      coalesce(sum(s.service_revenue), 0) as service_revenue,
      coalesce(sum(s.total), 0) as total_sales,
      coalesce(sum(s.total) filter (
        where s.payment_method = 'cash'
      ), 0) as cash_sales,
      coalesce(sum(s.total) filter (
        where s.payment_method = 'transfer'
      ), 0) as transfer_sales,
      coalesce(sum(s.total) filter (
        where s.payment_method = 'pos_card'
      ), 0) as card_sales,
      count(*) as sale_count
    from period_sales as s
  ),
  costs as (
    select coalesce(sum(
      -m.base_quantity_delta * m.sale_cost_per_base_unit
    ), 0) as product_cost
    from period_sales as s
    join public.sale_items as i
      on i.sale_id = s.id
      and i.pharmacy_id = target_pharmacy_id
      and i.item_kind = 'product'
    join public.stock_movements as m
      on m.sale_item_id = i.id
      and m.pharmacy_id = target_pharmacy_id
      and m.product_id = i.product_id
      and m.movement_type = 'sale'
  ),
  spending as (
    select
      coalesce(sum(e.amount), 0) as total_expenses,
      count(*) as expense_count
    from public.expenses as e
    where e.pharmacy_id = target_pharmacy_id
      and e.spent_at >= v_start and e.spent_at < v_end
  )
  select jsonb_build_object(
    'period', report_period,
    'start_date', v_start_date,
    'end_date', v_today,
    'product_revenue', round(r.product_revenue, 2)::text,
    'service_revenue', round(r.service_revenue, 2)::text,
    'total_sales', round(r.total_sales, 2)::text,
    'cash_sales', round(r.cash_sales, 2)::text,
    'transfer_sales', round(r.transfer_sales, 2)::text,
    'card_sales', round(r.card_sales, 2)::text,
    'product_cost', round(c.product_cost, 2)::text,
    'gross_profit', round(r.total_sales - c.product_cost, 2)::text,
    'total_expenses', round(e.total_expenses, 2)::text,
    'estimated_net_profit',
      round(r.total_sales - c.product_cost - e.total_expenses, 2)::text,
    'sale_count', r.sale_count::text,
    'expense_count', e.expense_count::text
  ) into v_result
  from revenue as r cross join costs as c cross join spending as e;

  return v_result;
end;
$$;

revoke all on function public.get_pharmacy_financial_summary(uuid, text)
  from public, anon;

grant execute on function public.get_pharmacy_financial_summary(uuid, text)
  to authenticated;
