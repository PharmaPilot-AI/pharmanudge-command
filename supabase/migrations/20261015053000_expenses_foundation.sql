-- Expense foundation. Authorized recording and reads follow separately.
-- Original entries are preserved; direct application access is denied.

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id)
    on delete restrict,
  client_operation_id uuid not null,
  recorded_by uuid not null references auth.users(id)
    on delete restrict,
  category text not null check (
    category in (
      'Utilities', 'Supplies', 'Logistics', 'Bank & POS charges',
      'Salaries & wages', 'Rent', 'Other'
    )
  ),
  description text not null check (
    description = btrim(description)
    and length(description) between 1 and 500
  ),
  amount numeric(18,2) not null check (
    amount > 0 and amount < 10000000000000000
  ),
  payment_source text not null check (
    payment_source in ('cash', 'transfer', 'pos_card')
  ),
  request_payload jsonb not null check (
    jsonb_typeof(request_payload) = 'object'
  ),
  spent_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  unique (pharmacy_id, client_operation_id),
  unique (pharmacy_id, id)
);

create index expenses_pharmacy_spent_idx
  on public.expenses(pharmacy_id, spent_at desc, id desc);

alter table public.expenses enable row level security;

revoke all on public.expenses
  from public, anon, authenticated;
