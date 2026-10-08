-- Pharmacy-scoped inventory derived from the stock movement ledger.
-- Purchase values are available only to active owners and accountants.
create or replace function public.list_pharmacy_inventory(
  target_pharmacy_id uuid
)
returns table (
  product_id uuid,
  product_name text,
  generic_name text,
  category text,
  shelf_location text,
  base_unit_label text,
  is_active boolean,
  on_hand_quantity text,
  available_quantity text,
  expired_quantity text,
  expiring_quantity text,
  stock_value text,
  expiring_value text,
  batch_count integer,
  nearest_expiry date,
  as_of_date date
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.pharmacy_role;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select m.role into v_role
  from public.pharmacy_members as m
  join public.pharmacies as p on p.id = m.pharmacy_id
  where m.pharmacy_id = target_pharmacy_id
    and m.user_id = auth.uid()
    and m.is_active = true
    and p.is_active = true;

  if not found then
    raise exception 'An active pharmacy membership is required to view inventory.'
      using errcode = '42501';
  end if;

  return query
  with movement_balances as (
    select m.batch_id, m.product_id, sum(m.base_quantity_delta) as quantity
    from public.stock_movements as m
    where m.pharmacy_id = target_pharmacy_id
    group by m.batch_id, m.product_id
  ),
  batch_balances as (
    select
      b.id,
      b.product_id,
      b.expiry_date,
      b.cost_per_base_unit,
      coalesce(m.quantity, 0) as quantity
    from public.stock_batches as b
    left join movement_balances as m
      on m.batch_id = b.id and m.product_id = b.product_id
    where b.pharmacy_id = target_pharmacy_id
  ),
  product_balances as (
    select
      b.product_id,
      sum(b.quantity) as on_hand,
      coalesce(sum(b.quantity) filter (
        where b.expiry_date > v_today
      ), 0) as available,
      coalesce(sum(b.quantity) filter (
        where b.expiry_date <= v_today
      ), 0) as expired,
      coalesce(sum(b.quantity) filter (
        where b.expiry_date > v_today and b.expiry_date <= v_today + 30
      ), 0) as expiring,
      sum(b.quantity * b.cost_per_base_unit) as value_at_cost,
      coalesce(sum(b.quantity * b.cost_per_base_unit) filter (
        where b.expiry_date > v_today and b.expiry_date <= v_today + 30
      ), 0) as expiring_at_cost,
      count(*) filter (where b.quantity > 0)::integer as positive_batches,
      min(b.expiry_date) filter (where b.quantity > 0) as nearest
    from batch_balances as b
    group by b.product_id
  )
  select
    p.id,
    p.name,
    p.generic_name,
    p.category,
    p.shelf_location,
    p.base_unit_label,
    p.is_active,
    coalesce(s.on_hand, 0)::text,
    coalesce(s.available, 0)::text,
    coalesce(s.expired, 0)::text,
    coalesce(s.expiring, 0)::text,
    case when v_role in ('owner', 'accountant')
      then round(coalesce(s.value_at_cost, 0), 2)::text
      else null::text
    end,
    case when v_role in ('owner', 'accountant')
      then round(coalesce(s.expiring_at_cost, 0), 2)::text
      else null::text
    end,
    coalesce(s.positive_batches, 0),
    s.nearest,
    v_today
  from public.products as p
  left join product_balances as s on s.product_id = p.id
  where p.pharmacy_id = target_pharmacy_id
    and (p.is_active = true or coalesce(s.on_hand, 0) <> 0)
  order by p.name, p.id;
end;
$$;

revoke all on function public.list_pharmacy_inventory(uuid)
  from public, anon;
grant execute on function public.list_pharmacy_inventory(uuid)
  to authenticated;
