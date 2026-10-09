-- Remaining batch stock and expiry, scoped to the caller's pharmacy.
create or replace function public.list_pharmacy_stock_batches(
  target_pharmacy_id uuid
)
returns table (
  batch_id uuid,
  product_id uuid,
  product_name text,
  base_unit_label text,
  product_is_active boolean,
  batch_number text,
  supplier_name text,
  expiry_date date,
  days_to_expiry integer,
  remaining_quantity text,
  stock_value text,
  received_at timestamptz,
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
    raise exception 'An active pharmacy membership is required to view stock batches.'
      using errcode = '42501';
  end if;

  return query
  with balances as (
    select m.batch_id, m.product_id, sum(m.base_quantity_delta) as quantity
    from public.stock_movements as m
    where m.pharmacy_id = target_pharmacy_id
    group by m.batch_id, m.product_id
  )
  select
    b.id,
    b.product_id,
    p.name,
    i.base_unit_label,
    p.is_active,
    b.batch_number,
    r.supplier_name,
    b.expiry_date,
    b.expiry_date - v_today,
    s.quantity::text,
    case when v_role in ('owner', 'accountant')
      then round(s.quantity * b.cost_per_base_unit, 2)::text
      else null::text
    end,
    b.received_at,
    v_today
  from public.stock_batches as b
  join balances as s
    on s.batch_id = b.id and s.product_id = b.product_id
  join public.products as p
    on p.id = b.product_id and p.pharmacy_id = b.pharmacy_id
  join public.stock_receipt_items as i
    on i.id = b.receipt_item_id
    and i.pharmacy_id = b.pharmacy_id
    and i.product_id = b.product_id
  join public.stock_receipts as r
    on r.id = i.receipt_id and r.pharmacy_id = i.pharmacy_id
  where b.pharmacy_id = target_pharmacy_id
    and s.quantity > 0
  order by b.expiry_date, p.name, b.received_at, b.id;
end;
$$;

revoke all on function public.list_pharmacy_stock_batches(uuid)
  from public, anon;
grant execute on function public.list_pharmacy_stock_batches(uuid)
  to authenticated;
