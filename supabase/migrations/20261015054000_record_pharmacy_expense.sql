-- Authorized, atomic and duplicate-safe expense recording.
create or replace function public.record_pharmacy_expense(
  target_pharmacy_id uuid,
  operation_id uuid,
  expense_category text,
  expense_description text,
  expense_amount numeric,
  expense_payment_source text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_category text := btrim(expense_category);
  v_description text := btrim(expense_description);
  v_source text := btrim(expense_payment_source);
  v_payload jsonb;
  v_existing public.expenses%rowtype;
  v_expense_id uuid;
begin
  if v_actor is null then
    raise exception 'Please sign in to record expenses.'
      using errcode = '42501';
  end if;

  if target_pharmacy_id is null or operation_id is null
    or v_category is null
    or v_category not in (
      'Utilities', 'Supplies', 'Logistics', 'Bank & POS charges',
      'Salaries & wages', 'Rent', 'Other'
    )
    or v_description is null
    or length(v_description) not between 1 and 500
    or v_source is null
    or v_source not in ('cash', 'transfer', 'pos_card')
  then
    raise exception 'Valid expense details are required.'
      using errcode = '22023';
  end if;

  -- Validate before assignment to numeric(18,2), which would round input.
  if expense_amount is null
    or expense_amount <= 0
    or expense_amount >= 10000000000000000
    or expense_amount <> round(expense_amount, 2)
  then
    raise exception 'Enter a positive amount with at most two decimal places.'
      using errcode = '22023';
  end if;

  -- Same pharmacy lock used by existing transactional/member commands.
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
      and m.role in ('owner', 'pharmacist', 'accountant')
  ) then
    raise exception 'Only an active owner, pharmacist or accountant can record expenses.'
      using errcode = '42501';
  end if;

  v_payload := jsonb_build_object(
    'category', v_category,
    'description', v_description,
    'amount', expense_amount,
    'payment_source', v_source
  );

  select e.* into v_existing
  from public.expenses as e
  where e.pharmacy_id = target_pharmacy_id
    and e.client_operation_id = operation_id;

  if found then
    if v_existing.recorded_by <> v_actor
      or v_existing.request_payload <> v_payload
    then
      raise exception 'This submission reference was already used for a different expense.'
        using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  insert into public.expenses (
    pharmacy_id, client_operation_id, recorded_by,
    category, description, amount, payment_source, request_payload
  )
  values (
    target_pharmacy_id, operation_id, v_actor,
    v_category, v_description, expense_amount, v_source, v_payload
  )
  returning id into v_expense_id;

  return v_expense_id;
end;
$$;

revoke all on function public.record_pharmacy_expense(
  uuid, uuid, text, text, numeric, text
) from public, anon;

grant execute on function public.record_pharmacy_expense(
  uuid, uuid, text, text, numeric, text
) to authenticated;
