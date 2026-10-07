-- Atomic, authorized and duplicate-safe stock receipt confirmation.
alter table public.stock_receipts
  add column request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object');

create or replace function public.confirm_stock_receipt(
  target_pharmacy_id uuid,
  operation_id uuid,
  receipt_supplier text,
  receipt_invoice text,
  receipt_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_supplier text := btrim(receipt_supplier);
  v_invoice text := btrim(coalesce(receipt_invoice, ''));
  v_payload jsonb;
  v_existing public.stock_receipts%rowtype;
  v_receipt_id uuid;
  v_item_id uuid;
  v_batch_id uuid;
  v_line jsonb;
  v_product public.products%rowtype;
  v_unit public.packaging_units%rowtype;
  v_quantity numeric;
  v_cost numeric;
  v_base_quantity numeric;
  v_batch_number text;
  v_expiry date;
  v_now timestamptz := clock_timestamp();
begin
  if v_actor is null then
    raise exception 'Please sign in to receive stock.'
      using errcode = '42501';
  end if;

  if target_pharmacy_id is null or operation_id is null
    or v_supplier is null
    or length(v_supplier) not between 1 and 200
    or length(v_invoice) > 100
  then
    raise exception 'Valid receipt details are required.'
      using errcode = '22023';
  end if;

  if receipt_items is null
    or jsonb_typeof(receipt_items) <> 'array'
  then
    raise exception 'Receipt items must be an array.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(receipt_items) not between 1 and 100 then
    raise exception 'A receipt must contain between 1 and 100 items.'
      using errcode = '22023';
  end if;

  -- Serialize receipt confirmation and membership changes for this pharmacy.
  perform 1 from public.pharmacies as p
  where p.id = target_pharmacy_id and p.is_active = true
  for update;

  if not found then
    raise exception 'Active pharmacy not found.';
  end if;

  if not exists (
    select 1 from public.pharmacy_members as m
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = v_actor
      and m.is_active = true
      and m.role in ('owner', 'pharmacist')
  ) then
    raise exception 'Only an active owner or pharmacist can receive stock.'
      using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'supplier', v_supplier,
    'invoice', v_invoice,
    'items', receipt_items
  );

  select r.* into v_existing
  from public.stock_receipts as r
  where r.pharmacy_id = target_pharmacy_id
    and r.client_operation_id = operation_id;

  if found then
    if v_existing.received_by <> v_actor
      or v_existing.request_payload <> v_payload
    then
      raise exception 'This submission reference was already used for a different receipt.'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.stock_receipts (
    pharmacy_id, client_operation_id, supplier_name,
    invoice_reference, received_by, received_at, request_payload
  )
  values (
    target_pharmacy_id, operation_id, v_supplier,
    v_invoice, v_actor, v_now, v_payload
  )
  returning id into v_receipt_id;

  -- Consistent catalogue lock order across multi-item receipts.
  for v_line in
    select e.value
    from jsonb_array_elements(receipt_items) with ordinality as e(value, position)
    order by e.value->>'product_id', e.value->>'packaging_unit_id', e.position
  loop
    if jsonb_typeof(v_line) <> 'object'
      or not (v_line ?& array[
        'product_id', 'packaging_unit_id', 'quantity',
        'cost_per_packaging_unit', 'batch_number', 'expiry_date'
      ])
      or jsonb_typeof(v_line->'product_id') <> 'string'
      or jsonb_typeof(v_line->'packaging_unit_id') <> 'string'
      or jsonb_typeof(v_line->'quantity') <> 'number'
      or jsonb_typeof(v_line->'cost_per_packaging_unit') <> 'number'
      or jsonb_typeof(v_line->'batch_number') <> 'string'
      or jsonb_typeof(v_line->'expiry_date') <> 'string'
    then
      raise exception 'Each receipt item must contain valid product, unit, quantity, cost, batch and expiry fields.'
        using errcode = '22023';
    end if;

    select p.* into v_product
    from public.products as p
    where p.id = (v_line->>'product_id')::uuid
      and p.pharmacy_id = target_pharmacy_id
      and p.is_active = true
    for share;

    if not found then
      raise exception 'An active product was not found in this pharmacy.';
    end if;

    select u.* into v_unit
    from public.packaging_units as u
    where u.id = (v_line->>'packaging_unit_id')::uuid
      and u.product_id = v_product.id
      and u.is_active = true
    for share;

    if not found then
      raise exception 'An active packaging unit was not found for this product.';
    end if;

    v_quantity := (v_line->>'quantity')::numeric;
    v_cost := (v_line->>'cost_per_packaging_unit')::numeric;
    v_base_quantity := v_quantity * v_unit.base_units_per_unit;
    v_batch_number := btrim(v_line->>'batch_number');

    if v_quantity <= 0 or v_quantity >= 1000000000000
      or v_quantity <> round(v_quantity, 6)
      or v_cost < 0 or v_cost >= 1000000000000
      or v_cost <> round(v_cost, 6)
      or v_base_quantity >= 1000000000000
      or round(v_quantity * v_cost, 2) >= 10000000000000000
      or length(v_batch_number) not between 1 and 100
      or (v_line->>'expiry_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then
      raise exception 'Receipt quantity, cost, batch or expiry is invalid.'
        using errcode = '22023';
    end if;

    v_expiry := (v_line->>'expiry_date')::date;
    if not isfinite(v_expiry)
      or v_expiry <= (v_now at time zone 'Africa/Lagos')::date
    then
      raise exception 'Stock expiry must be after today.'
        using errcode = '22023';
    end if;

    insert into public.stock_receipt_items (
      pharmacy_id, receipt_id, product_id, packaging_unit_id,
      product_name, base_unit_label, packaging_unit_label,
      conversion_factor, quantity, base_quantity,
      cost_per_packaging_unit, line_total, batch_number, expiry_date
    )
    values (
      target_pharmacy_id, v_receipt_id, v_product.id, v_unit.id,
      v_product.name, v_product.base_unit_label, v_unit.label,
      v_unit.base_units_per_unit, v_quantity, v_base_quantity,
      v_cost, round(v_quantity * v_cost, 2), v_batch_number, v_expiry
    )
    returning id into v_item_id;

    insert into public.stock_batches (
      pharmacy_id, receipt_item_id, product_id, batch_number,
      expiry_date, received_base_quantity, cost_per_base_unit, received_at
    )
    values (
      target_pharmacy_id, v_item_id, v_product.id, v_batch_number,
      v_expiry, v_base_quantity,
      round(v_cost / v_unit.base_units_per_unit, 12), v_now
    )
    returning id into v_batch_id;

    insert into public.stock_movements (
      pharmacy_id, product_id, batch_id, receipt_item_id,
      movement_type, base_quantity_delta, actor_user_id, occurred_at
    )
    values (
      target_pharmacy_id, v_product.id, v_batch_id, v_item_id,
      'receipt', v_base_quantity, v_actor, v_now
    );
  end loop;

  return v_receipt_id;
end;
$$;

revoke all on function public.confirm_stock_receipt(uuid, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.confirm_stock_receipt(uuid, uuid, text, text, jsonb)
  to authenticated;
