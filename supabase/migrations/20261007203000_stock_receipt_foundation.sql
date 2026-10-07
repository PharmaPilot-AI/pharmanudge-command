-- Stock receipt foundation. Confirmation is added in a later migration.
-- Historical labels, conversions and purchase costs are preserved as snapshots.

create table public.stock_receipts (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete restrict,
  client_operation_id uuid not null,
  supplier_name text not null,
  invoice_reference text not null default '',
  received_by uuid not null references auth.users(id) on delete restrict,
  received_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint stock_receipt_supplier_valid check (
    supplier_name = btrim(supplier_name)
    and length(supplier_name) between 1 and 200
  ),
  constraint stock_receipt_invoice_valid check (
    invoice_reference = btrim(invoice_reference)
    and length(invoice_reference) <= 100
  ),
  unique (pharmacy_id, client_operation_id),
  unique (pharmacy_id, id)
);

create table public.stock_receipt_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null,
  receipt_id uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  packaging_unit_id uuid not null references public.packaging_units(id) on delete restrict,
  product_name text not null,
  base_unit_label text not null,
  packaging_unit_label text not null,
  conversion_factor integer not null check (conversion_factor >= 1),
  quantity numeric(18,6) not null check (quantity > 0 and quantity < 1000000000000),
  base_quantity numeric(18,6) not null check (
    base_quantity > 0 and base_quantity < 1000000000000
    and base_quantity = quantity * conversion_factor
  ),
  cost_per_packaging_unit numeric(18,6) not null check (
    cost_per_packaging_unit >= 0 and cost_per_packaging_unit < 1000000000000
  ),
  line_total numeric(18,2) not null check (
    line_total >= 0 and line_total < 10000000000000000
    and line_total = round(quantity * cost_per_packaging_unit, 2)
  ),
  batch_number text not null check (
    batch_number = btrim(batch_number)
    and length(batch_number) between 1 and 100
  ),
  expiry_date date not null check (isfinite(expiry_date)),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (pharmacy_id, receipt_id)
    references public.stock_receipts(pharmacy_id, id) on delete restrict,
  unique (pharmacy_id, id),
  unique (pharmacy_id, id, product_id)
);

-- Each receipt item creates its own cost layer, even for a repeated batch number.
create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null,
  receipt_item_id uuid not null unique,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_number text not null check (
    batch_number = btrim(batch_number)
    and length(batch_number) between 1 and 100
  ),
  expiry_date date not null check (isfinite(expiry_date)),
  received_base_quantity numeric(18,6) not null check (
    received_base_quantity > 0 and received_base_quantity < 1000000000000
  ),
  cost_per_base_unit numeric(24,12) not null check (
    cost_per_base_unit >= 0 and cost_per_base_unit < 1000000000000
  ),
  received_at timestamptz not null default clock_timestamp(),
  foreign key (pharmacy_id, receipt_item_id, product_id)
    references public.stock_receipt_items(pharmacy_id, id, product_id) on delete restrict,
  unique (pharmacy_id, id, product_id)
);

-- Stock balances will be derived from movements.
-- This first stage permits receipt movements only.
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null,
  product_id uuid not null,
  batch_id uuid not null,
  receipt_item_id uuid not null unique,
  movement_type text not null check (movement_type = 'receipt'),
  base_quantity_delta numeric(18,6) not null check (
    base_quantity_delta > 0 and base_quantity_delta < 1000000000000
  ),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (pharmacy_id, batch_id, product_id)
    references public.stock_batches(pharmacy_id, id, product_id) on delete restrict,
  foreign key (pharmacy_id, receipt_item_id, product_id)
    references public.stock_receipt_items(pharmacy_id, id, product_id) on delete restrict
);

create index stock_receipts_pharmacy_received_idx
  on public.stock_receipts(pharmacy_id, received_at desc, id desc);

create index stock_receipt_items_receipt_idx
  on public.stock_receipt_items(pharmacy_id, receipt_id);

create index stock_batches_product_expiry_idx
  on public.stock_batches(pharmacy_id, product_id, expiry_date, received_at, id);

create index stock_movements_batch_idx
  on public.stock_movements(pharmacy_id, batch_id);

create index stock_movements_product_idx
  on public.stock_movements(pharmacy_id, product_id);

alter table public.stock_receipts enable row level security;
alter table public.stock_receipt_items enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;

-- Application access will use explicitly authorized database functions.
revoke all on public.stock_receipts,
  public.stock_receipt_items,
  public.stock_batches,
  public.stock_movements
  from public, anon, authenticated;
