-- Checkpoint 5 — PharmaPilot catalog schema + tenancy foundation + RLS (read-only policies)
-- Not applied to any project by this file's creation. Apply only in a separately approved checkpoint.

-- Ensure gen_random_uuid() is available.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tenancy foundation
-- ---------------------------------------------------------------------------

create type public.pharmacy_role as enum ('owner', 'pharmacist', 'cashier', 'accountant');

create table public.pharmacies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pharmacy_members (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.pharmacy_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pharmacy_id, user_id)
);

create index pharmacy_members_user_id_idx on public.pharmacy_members (user_id);

-- ---------------------------------------------------------------------------
-- Catalog tables
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete restrict,
  name text not null,
  generic_name text not null default '',
  category text not null default '',
  barcode text,
  base_unit_label text not null,
  cost_per_base_unit numeric(12, 2) not null default 0 check (cost_per_base_unit >= 0),
  shelf_location text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_pharmacy_id_idx on public.products (pharmacy_id);
create unique index products_pharmacy_barcode_key
  on public.products (pharmacy_id, barcode)
  where barcode is not null;

create table public.packaging_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  label text not null,
  base_units_per_unit integer not null check (base_units_per_unit >= 1),
  price numeric(12, 2) not null check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, label)
);

create index packaging_units_product_id_idx on public.packaging_units (product_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  pharmacy_id uuid not null references public.pharmacies (id) on delete restrict,
  name text not null,
  description text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  category text not null default '',
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index services_pharmacy_id_idx on public.services (pharmacy_id);

-- ---------------------------------------------------------------------------
-- Timestamp maintenance (updated_at auto-set; created_at pinned against mutation)
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.created_at = old.created_at;
  return new;
end;
$$;

create trigger pharmacies_set_updated_at
  before update on public.pharmacies
  for each row execute function public.set_updated_at();

create trigger pharmacy_members_set_updated_at
  before update on public.pharmacy_members
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger packaging_units_set_updated_at
  before update on public.packaging_units
  for each row execute function public.set_updated_at();

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper (SECURITY DEFINER avoids recursive policy evaluation)
-- ---------------------------------------------------------------------------

create or replace function public.is_pharmacy_member(target_pharmacy_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.pharmacy_members m
    join public.pharmacies p on p.id = m.pharmacy_id
    where m.pharmacy_id = target_pharmacy_id
      and m.user_id = auth.uid()
      and m.is_active = true
      and p.id = target_pharmacy_id
      and p.is_active = true
  );
$$;

revoke execute on function public.is_pharmacy_member(uuid) from public;
grant execute on function public.is_pharmacy_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS enablement + read-only policies
-- ---------------------------------------------------------------------------

alter table public.pharmacies enable row level security;
alter table public.pharmacy_members enable row level security;
alter table public.products enable row level security;
alter table public.packaging_units enable row level security;
alter table public.services enable row level security;

create policy pharmacies_select_members
  on public.pharmacies
  for select
  using (public.is_pharmacy_member(id));

create policy pharmacy_members_select_self_or_peers
  on public.pharmacy_members
  for select
  using (
    user_id = auth.uid()
    or public.is_pharmacy_member(pharmacy_id)
  );

create policy products_select_members
  on public.products
  for select
  using (public.is_pharmacy_member(pharmacy_id));

create policy packaging_units_select_members
  on public.packaging_units
  for select
  using (
    exists (
      select 1
      from public.products p
      where p.id = packaging_units.product_id
        and public.is_pharmacy_member(p.pharmacy_id)
    )
  );

create policy services_select_members
  on public.services
  for select
  using (public.is_pharmacy_member(pharmacy_id));

-- No INSERT, UPDATE, or DELETE policies are defined for any table in this
-- migration. Ordinary authenticated/anon roles therefore cannot write to
-- pharmacies, pharmacy_members, products, packaging_units, or services.
-- Only service_role (bypasses RLS) or direct database access can write,
-- until a separately approved future checkpoint defines the write model.
