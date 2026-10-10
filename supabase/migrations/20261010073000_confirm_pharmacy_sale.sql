-- Atomic checkout with server-verified prices and FEFO stock allocation.
create or replace function public.confirm_pharmacy_sale(
  target_pharmacy_id uuid,
  operation_id uuid,
  sale_payment_method text,
  sale_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_payload jsonb;
  v_existing public.sales%rowtype;
  v_sale_id uuid;
  v_item_id uuid;
  v_line jsonb;
  v_position integer;
  v_product public.products%rowtype;
  v_unit public.packaging_units%rowtype;
  v_service public.services%rowtype;
  v_batch public.stock_batches%rowtype;
  v_quantity numeric;
  v_expected_price numeric;
  v_price numeric;
  v_base_quantity numeric;
  v_remaining numeric;
  v_balance numeric;
  v_take numeric;
  v_line_total numeric;
  v_product_revenue numeric := 0;
  v_service_revenue numeric := 0;
  v_now timestamptz;
  v_today date;
begin
  if v_actor is null then
    raise exception 'Please sign in to complete a sale.'
      using errcode = '42501';
  end if;

  if target_pharmacy_id is null or operation_id is null
    or sale_payment_method is null
    or sale_payment_method not in ('cash', 'transfer', 'pos_card')
  then
    raise exception 'Valid sale details are required.'
      using errcode = '22023';
  end if;

  if sale_lines is null or jsonb_typeof(sale_lines) <> 'array' then
    raise exception 'Sale lines must be an array.'
      using errcode = '22023';
  end if;

  if jsonb_array_length(sale_lines) not between 1 and 100 then
    raise exception 'A sale must contain between 1 and 100 lines.'
      using errcode = '22023';
  end if;

  -- Same pharmacy lock used by receipt confirmation and membership changes.
  -- Serializes checkouts so concurrent sales cannot consume the same stock.
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
      and m.role in ('owner', 'pharmacist', 'cashier')
  ) then
    raise exception 'Only an active owner, pharmacist or cashier can complete a sale.'
      using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'payment_method', sale_payment_method,
    'lines', sale_lines
  );

  select s.* into v_existing
  from public.sales as s
  where s.pharmacy_id = target_pharmacy_id
    and s.client_operation_id = operation_id;

  if found then
    if v_existing.sold_by <> v_actor
      or v_existing.request_payload <> v_payload
    then
      raise exception 'This submission reference was already used for a different sale.'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  v_now := clock_timestamp();
  v_today := (v_now at time zone 'Africa/Lagos')::date;

  insert into public.sales (
    pharmacy_id, client_operation_id, sold_by, payment_method,
    product_revenue, service_revenue, total, request_payload, sold_at
  )
  values (
    target_pharmacy_id, operation_id, v_actor, sale_payment_method,
    0, 0, 0, v_payload, v_now
  )
  returning id into v_sale_id;

  for v_line, v_position in
    select e.value, e.position::integer
    from jsonb_array_elements(sale_lines)
      with ordinality as e(value, position)
    order by e.value->>'kind', e.value->>'product_id',
      e.value->>'packaging_unit_id', e.value->>'service_id', e.position
  loop
    if jsonb_typeof(v_line) <> 'object'
      or not (v_line ?& array['kind', 'quantity', 'expected_unit_price'])
      or jsonb_typeof(v_line->'kind') <> 'string'
      or jsonb_typeof(v_line->'quantity') <> 'number'
      or jsonb_typeof(v_line->'expected_unit_price') <> 'number'
      or v_line->>'kind' not in ('product', 'service')
    then
      raise exception 'Each sale line requires a valid kind, quantity and expected price.'
        using errcode = '22023';
    end if;

    v_quantity := (v_line->>'quantity')::numeric;
    v_expected_price := (v_line->>'expected_unit_price')::numeric;

    if v_quantity <= 0 or v_quantity >= 1000000000000
      or v_quantity <> round(v_quantity, 6)
      or v_expected_price < 0 or v_expected_price >= 1000000000000
      or v_expected_price <> round(v_expected_price, 6)
    then
      raise exception 'Sale quantity or expected price is invalid.'
        using errcode = '22023';
    end if;

    if v_line->>'kind' = 'product' then
      if not (v_line ?& array['product_id', 'packaging_unit_id'])
        or jsonb_typeof(v_line->'product_id') <> 'string'
        or jsonb_typeof(v_line->'packaging_unit_id') <> 'string'
      then
        raise exception 'Product and packaging unit references are required.'
          using errcode = '22023';
      end if;

      select p.* into v_product
      from public.products as p
      where p.id = (v_line->>'product_id')::uuid
        and p.pharmacy_id = target_pharmacy_id
        and p.is_active = true
      for share;

      if not found then
        raise exception 'An active product was not found in this pharmacy.'
          using errcode = '22023';
      end if;

      select u.* into v_unit
      from public.packaging_units as u
      where u.id = (v_line->>'packaging_unit_id')::uuid
        and u.product_id = v_product.id
        and u.is_active = true
      for share;

      if not found then
        raise exception 'An active selling unit was not found for this product.'
          using errcode = '22023';
      end if;

      v_price := v_unit.price;
      v_base_quantity := v_quantity * v_unit.base_units_per_unit;
    else
      if not (v_line ? 'service_id')
        or jsonb_typeof(v_line->'service_id') <> 'string'
      then
        raise exception 'A service reference is required.'
          using errcode = '22023';
      end if;

      select s.* into v_service
      from public.services as s
      where s.id = (v_line->>'service_id')::uuid
        and s.pharmacy_id = target_pharmacy_id
        and s.is_active = true
      for share;

      if not found then
        raise exception 'An active service was not found in this pharmacy.'
          using errcode = '22023';
      end if;

      v_price := v_service.price;
      v_base_quantity := null;
    end if;

    if v_price is null or v_price < 0 or v_price >= 1000000000000
      or v_price <> round(v_price, 6)
    then
      raise exception 'The catalogue selling price is invalid.'
        using errcode = '22023';
    end if;

    if v_price <> v_expected_price then
      raise exception 'A selling price has changed. Refresh the catalogue and review the sale.'
        using errcode = '22023';
    end if;

    v_line_total := round(v_quantity * v_price, 2);

    if v_line_total >= 10000000000000000
      or (v_base_quantity is not null and (
        v_base_quantity <= 0 or v_base_quantity >= 1000000000000
      ))
    then
      raise exception 'Sale line exceeds the supported amount or quantity.'
        using errcode = '22023';
    end if;

    if v_line->>'kind' = 'product' then
      insert into public.sale_items (
        pharmacy_id, sale_id, line_number, item_kind,
        product_id, packaging_unit_id, item_name,
        base_unit_label, packaging_unit_label, conversion_factor,
        quantity, base_quantity, unit_price, line_total
      )
      values (
        target_pharmacy_id, v_sale_id, v_position, 'product',
        v_product.id, v_unit.id, v_product.name,
        v_product.base_unit_label, v_unit.label, v_unit.base_units_per_unit,
        v_quantity, v_base_quantity, v_price, v_line_total
      )
      returning id into v_item_id;

      v_remaining := v_base_quantity;

      for v_batch in
        select b.*
        from public.stock_batches as b
        where b.pharmacy_id = target_pharmacy_id
          and b.product_id = v_product.id
          and b.expiry_date > v_today
        order by b.expiry_date, b.received_at, b.id
        for update
      loop
        select coalesce(sum(m.base_quantity_delta), 0) into v_balance
        from public.stock_movements as m
        where m.pharmacy_id = target_pharmacy_id
          and m.product_id = v_product.id
          and m.batch_id = v_batch.id;

        if v_balance < 0 then
          raise exception 'Invalid batch balance. Ask the owner to review inventory.';
        end if;

        if v_balance = 0 then
          continue;
        end if;

        v_take := least(v_remaining, v_balance);

        insert into public.stock_movements (
          pharmacy_id, product_id, batch_id, sale_item_id,
          movement_type, base_quantity_delta, sale_cost_per_base_unit,
          actor_user_id, occurred_at
        )
        values (
          target_pharmacy_id, v_product.id, v_batch.id, v_item_id,
          'sale', -v_take, v_batch.cost_per_base_unit, v_actor, v_now
        );

        v_remaining := v_remaining - v_take;
        exit when v_remaining = 0;
      end loop;

      if v_remaining > 0 then
        raise exception 'Insufficient unexpired stock for %. Review quantities and refresh inventory.',
          v_product.name
          using errcode = '22023';
      end if;

      v_product_revenue := v_product_revenue + v_line_total;
    else
      insert into public.sale_items (
        pharmacy_id, sale_id, line_number, item_kind,
        service_id, item_name, quantity, unit_price, line_total
      )
      values (
        target_pharmacy_id, v_sale_id, v_position, 'service',
        v_service.id, v_service.name, v_quantity, v_price, v_line_total
      );

      v_service_revenue := v_service_revenue + v_line_total;
    end if;
  end loop;

  if v_product_revenue + v_service_revenue >= 10000000000000000 then
    raise exception 'Sale total exceeds the supported amount.'
      using errcode = '22023';
  end if;

  update public.sales
  set product_revenue = v_product_revenue,
      service_revenue = v_service_revenue,
      total = v_product_revenue + v_service_revenue
  where id = v_sale_id and pharmacy_id = target_pharmacy_id;

  return v_sale_id;
end;
$$;

revoke all on function public.confirm_pharmacy_sale(uuid, uuid, text, jsonb)
  from public, anon;
grant execute on function public.confirm_pharmacy_sale(uuid, uuid, text, jsonb)
  to authenticated;
