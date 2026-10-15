-- Daily pharmacy action queue.
-- Workflow changes never alter the underlying stock or financial records.
-- Authorized generation, reads and updates follow separately.

create table public.pharmacy_actions (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id)
    on delete restrict,
  business_date date not null check (
    isfinite(business_date)
    and business_date between date '2000-01-01' and date '2100-12-31'
  ),
  action_key text not null check (
    action_key = btrim(action_key)
    and length(action_key) between 1 and 200
  ),
  action_kind text not null check (
    action_kind in (
      'out_of_stock', 'expired_batch', 'expiring_batch',
      'cash_variance', 'unreconciled_day'
    )
  ),
  severity text not null check (
    severity in ('critical', 'warning', 'info')
  ),
  title text not null check (
    length(btrim(title)) between 1 and 300
  ),
  detail text not null check (
    length(btrim(detail)) between 1 and 2000
  ),
  source_active boolean not null default true,
  source_snapshot jsonb not null check (
    jsonb_typeof(source_snapshot) = 'object'
  ),
  status text not null default 'open' check (
    status in ('open', 'snoozed', 'resolved')
  ),
  snoozed_until date,
  assignee_user_id uuid references auth.users(id)
    on delete restrict,
  resolved_by uuid references auth.users(id)
    on delete restrict,
  resolved_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint pharmacy_action_snooze_valid check (
    (
      status = 'snoozed'
      and snoozed_until is not null
      and isfinite(snoozed_until)
      and snoozed_until > business_date
      and snoozed_until <= date '2100-12-31'
    )
    or (status <> 'snoozed' and snoozed_until is null)
  ),
  constraint pharmacy_action_resolution_valid check (
    (
      status = 'resolved'
      and resolved_by is not null
      and resolved_at is not null
    )
    or (
      status <> 'resolved'
      and resolved_by is null
      and resolved_at is null
    )
  ),
  unique (pharmacy_id, business_date, action_key),
  unique (pharmacy_id, id)
);

create index pharmacy_actions_queue_idx
  on public.pharmacy_actions(pharmacy_id, business_date desc, status);

alter table public.pharmacy_actions enable row level security;

revoke all on public.pharmacy_actions
  from public, anon, authenticated;
