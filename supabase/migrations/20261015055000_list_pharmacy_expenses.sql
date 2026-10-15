-- Authorized expenses for one Lagos business day.
create or replace function public.list_pharmacy_expenses(
  target_pharmacy_id uuid,
  target_date date default (now() at time zone 'Africa/Lagos')::date
)
returns table (
  expense_id uuid,
  category text,
  description text,
  amount text,
  payment_source text,
  recorded_by uuid,
  spent_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.pharmacy_role;
  v_start timestamptz;
  v_end timestamptz;
begin
  select m.role into v_role
  from public.pharmacy_members as m
  join public.pharmacies as p on p.id = m.pharmacy_id
  where m.pharmacy_id = target_pharmacy_id
    and m.user_id = auth.uid()
    and m.is_active = true
    and p.is_active = true;

  if not found then
    raise exception 'An active pharmacy membership is required to view expenses.'
      using errcode = '42501';
  end if;

  if v_role not in ('owner', 'pharmacist', 'accountant') then
    raise exception 'Only an active owner, pharmacist or accountant can view expenses.'
      using errcode = '42501';
  end if;

  if target_date is null or not isfinite(target_date)
    or target_date < date '2000-01-01'
    or target_date > date '2100-12-31'
  then
    raise exception 'A valid expense date between 2000 and 2100 is required.'
      using errcode = '22023';
  end if;

  v_start := target_date::timestamp at time zone 'Africa/Lagos';
  v_end := (target_date + 1)::timestamp at time zone 'Africa/Lagos';

  return query
  select
    e.id,
    e.category,
    e.description,
    e.amount::text,
    e.payment_source,
    e.recorded_by,
    e.spent_at
  from public.expenses as e
  where e.pharmacy_id = target_pharmacy_id
    and e.spent_at >= v_start
    and e.spent_at < v_end
  order by e.spent_at desc, e.id desc;
end;
$$;

revoke all on function public.list_pharmacy_expenses(uuid, date)
  from public, anon;

grant execute on function public.list_pharmacy_expenses(uuid, date)
  to authenticated;
