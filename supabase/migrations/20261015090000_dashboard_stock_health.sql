-- Owner dashboard stock counts from the complete movement ledger.
create or replace function public.get_pharmacy_stock_health(
  target_pharmacy_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb;
begin
  if not exists (
    select 1 from public.pharmacy_members as m
    join public.pharmacies as p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.is_active = true
      and m.role = 'owner'
  ) then
    raise exception 'Only an active owner can view dashboard stock health.'
      using errcode = '42501';
  end if;

  with balances as (
    select m.batch_id, m.product_id,
      sum(m.base_quantity_delta) as quantity
    from public.stock_movements as m
    where m.pharmacy_id = target_pharmacy_id
    group by m.batch_id, m.product_id
  ),
  batches as (
    select b.product_id, b.expiry_date,
      coalesce(m.quantity, 0) as quantity
    from public.stock_batches as b
    left join balances as m
      on m.batch_id = b.id and m.product_id = b.product_id
    where b.pharmacy_id = target_pharmacy_id
  ),
  available as (
    select b.product_id, sum(b.quantity) as quantity
    from batches as b
    where b.expiry_date > v_today
    group by b.product_id
  ),
  product_counts as (
    select
      count(*) as active_products,
      count(*) filter (
        where coalesce(a.quantity, 0) <= 0
      ) as out_of_stock_products
    from public.products as p
    left join available as a on a.product_id = p.id
    where p.pharmacy_id = target_pharmacy_id
      and p.is_active = true
  ),
  batch_counts as (
    select
      count(*) filter (
        where b.quantity > 0
          and b.expiry_date > v_today
          and b.expiry_date <= v_today + 30
      ) as expiring_batches,
      count(*) filter (
        where b.quantity > 0 and b.expiry_date <= v_today
      ) as expired_batches
    from batches as b
  )
  select jsonb_build_object(
    'as_of_date', v_today,
    'active_products', p.active_products::text,
    'out_of_stock_products', p.out_of_stock_products::text,
    'expiring_batches', b.expiring_batches::text,
    'expired_batches', b.expired_batches::text,
    'low_stock_products', null::text
  ) into v_result
  from product_counts as p cross join batch_counts as b;

  return v_result;
end;
$$;

revoke all on function public.get_pharmacy_stock_health(uuid)
  from public, anon;

grant execute on function public.get_pharmacy_stock_health(uuid)
  to authenticated;
