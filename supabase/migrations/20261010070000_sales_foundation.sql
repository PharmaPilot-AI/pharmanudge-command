-- Sales foundation. Authorized checkout is added in a later migration.
-- Historical catalogue details and prices are preserved as snapshots.

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies(id) on delete restrict,
  client_operation_id uuid not null,
  sold_by uuid not null references auth.users(id) on delete restrict,
  payment_method text not null check (
    payment_method in ('cash', 'transfer', 'pos_card')
  ),
  product_revenue numeric(18,2) not null check (
    product_revenue >= 0 and product_revenue < 10000000000000000
  ),
  service_revenue numeric(18,2) not null check (
    service_revenue >= 0 and service_revenue < 10000000000000000
  ),
  total numeric(18,2) not null check (
    total >= 0 and total < 10000000000000000
    and total = product_revenue + service_revenue
  ),
  request_payload jsonb not null check (
    jsonb_typeof(request_payload) = 'object'
  ),
  sold_at timestamptz not null default clock_timestamp(),
  unique (pharmacy_id, client_operation_id),
  unique (pharmacy_id, id)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null,
  sale_id uuid not null,
  line_number integer not null check (line_number between 1 and 100),
  item_kind text not null check (item_kind in ('product', 'service')),
  product_id uuid references public.products(id) on delete restrict,
  packaging_unit_id uuid references public.packaging_units(id) on delete restrict,
  service_id uuid references public.services(id) on delete restrict,
  item_name text not null,
  base_unit_label text,
  packaging_unit_label text,
  conversion_factor integer,
  quantity numeric(18,6) not null check (
    quantity > 0 and quantity < 1000000000000
  ),
  base_quantity numeric(18,6),
  unit_price numeric(18,6) not null check (
    unit_price >= 0 and unit_price < 1000000000000
  ),
  line_total numeric(18,2) not null check (
    line_total >= 0 and line_total < 10000000000000000
    and line_total = round(quantity * unit_price, 2)
  ),
  created_at timestamptz not null default clock_timestamp(),
  constraint sale_item_kind_fields_valid check (
    (
      item_kind = 'product'
      and product_id is not null
      and packaging_unit_id is not null
      and service_id is null
      and base_unit_label is not null
      and packaging_unit_label is not null
      and conversion_factor is not null
      and conversion_factor >= 1
      and base_quantity is not null
      and base_quantity > 0
      and base_quantity < 1000000000000
      and base_quantity = quantity * conversion_factor
    )
    or
    (
      item_kind = 'service'
      and service_id is not null
      and product_id is null
      and packaging_unit_id is null
      and base_unit_label is null
      and packaging_unit_label is null
      and conversion_factor is null
      and base_quantity is null
    )
  ),
  foreign key (pharmacy_id, sale_id)
    references public.sales(pharmacy_id, id) on delete restrict,
  unique (pharmacy_id, sale_id, line_number),
  unique (pharmacy_id, id),
  unique (pharmacy_id, id, product_id)
);

create index sales_pharmacy_sold_idx
  on public.sales(pharmacy_id, sold_at desc, id desc);

create index sale_items_sale_idx
  on public.sale_items(pharmacy_id, sale_id);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;

-- Access will use explicitly authorized database functions.
revoke all on public.sales, public.sale_items
  from public, anon, authenticated;
