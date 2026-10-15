-- Immutable daily reconciliation snapshots.
-- Authorized closing and reads are added separately.

create table public.daily_closures (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id)
    on delete restrict,
  business_date date not null check (
    isfinite(business_date)
    and business_date between date '2000-01-01' and date '2100-12-31'
  ),
  client_operation_id uuid not null,
  closed_by uuid not null references auth.users(id)
    on delete restrict,
  opening_cash numeric(18,2) not null check (
    opening_cash >= 0 and opening_cash < 10000000000000000
  ),
  cash_sales numeric(18,2) not null check (
    cash_sales >= 0 and cash_sales < 10000000000000000
  ),
  transfer_sales numeric(18,2) not null check (
    transfer_sales >= 0 and transfer_sales < 10000000000000000
  ),
  card_sales numeric(18,2) not null check (
    card_sales >= 0 and card_sales < 10000000000000000
  ),
  cash_expenses numeric(18,2) not null check (
    cash_expenses >= 0 and cash_expenses < 10000000000000000
  ),
  transfer_expenses numeric(18,2) not null check (
    transfer_expenses >= 0 and transfer_expenses < 10000000000000000
  ),
  card_expenses numeric(18,2) not null check (
    card_expenses >= 0 and card_expenses < 10000000000000000
  ),
  expected_cash numeric(20,2) generated always as (
    opening_cash + cash_sales - cash_expenses
  ) stored,
  counted_cash numeric(18,2) not null check (
    counted_cash >= 0 and counted_cash < 10000000000000000
  ),
  cash_variance numeric(20,2) generated always as (
    counted_cash - (opening_cash + cash_sales - cash_expenses)
  ) stored,
  sale_count bigint not null check (sale_count >= 0),
  expense_count bigint not null check (expense_count >= 0),
  notes text not null default '' check (
    notes = btrim(notes) and length(notes) <= 1000
  ),
  request_payload jsonb not null check (
    jsonb_typeof(request_payload) = 'object'
  ),
  closed_at timestamptz not null default clock_timestamp(),
  unique (pharmacy_id, business_date),
  unique (pharmacy_id, client_operation_id),
  unique (pharmacy_id, id)
);

alter table public.daily_closures enable row level security;

revoke all on public.daily_closures
  from public, anon, authenticated;
