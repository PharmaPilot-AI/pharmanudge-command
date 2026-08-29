-- Checkpoint 2 (Phase 2B) — minimum pharmacy-scoped write-enabling RLS for the
-- catalogue tables (products, packaging_units, services).
-- Not applied to any project by this file's creation. Apply only in a
-- separately approved dedicated RLS/security gate.
--
-- Existing SELECT policies (from 20260825132459_catalog_and_tenancy_foundation.sql)
-- are untouched by this migration. This migration adds INSERT, UPDATE, and
-- DELETE policies only, scoped by the same public.is_pharmacy_member(uuid)
-- helper already used by the SELECT policies.
--
-- packaging_units has no pharmacy_id column of its own — ownership is only
-- reachable via product_id. Its INSERT/UPDATE/DELETE policies join back to
-- products to verify the referenced product's pharmacy_id, exactly mirroring
-- packaging_units_select_members. For UPDATE specifically, both the USING
-- clause (old row's product) and the WITH CHECK clause (new row's product)
-- independently re-verify ownership, so a caller can neither edit a unit
-- attached to a product they don't own, nor use UPDATE to re-point their own
-- unit's product_id at a product belonging to a different pharmacy.

-- ---------------------------------------------------------------------------
-- Table-level grants (RLS policies alone do not grant DML access — Postgres
-- requires both a GRANT and a passing policy for a command to succeed)
-- ---------------------------------------------------------------------------

grant insert, update, delete on public.products to authenticated;
grant insert, update, delete on public.packaging_units to authenticated;
grant insert, update, delete on public.services to authenticated;

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------

create policy products_insert_members
  on public.products
  for insert
  with check (public.is_pharmacy_member(pharmacy_id));

create policy products_update_members
  on public.products
  for update
  using (public.is_pharmacy_member(pharmacy_id))
  with check (public.is_pharmacy_member(pharmacy_id));

create policy products_delete_members
  on public.products
  for delete
  using (public.is_pharmacy_member(pharmacy_id));

-- ---------------------------------------------------------------------------
-- packaging_units (ownership via product_id -> products.pharmacy_id)
-- ---------------------------------------------------------------------------

create policy packaging_units_insert_members
  on public.packaging_units
  for insert
  with check (
    exists (
      select 1
      from public.products p
      where p.id = packaging_units.product_id
        and public.is_pharmacy_member(p.pharmacy_id)
    )
  );

create policy packaging_units_update_members
  on public.packaging_units
  for update
  using (
    exists (
      select 1
      from public.products p
      where p.id = packaging_units.product_id
        and public.is_pharmacy_member(p.pharmacy_id)
    )
  )
  with check (
    exists (
      select 1
      from public.products p
      where p.id = packaging_units.product_id
        and public.is_pharmacy_member(p.pharmacy_id)
    )
  );

create policy packaging_units_delete_members
  on public.packaging_units
  for delete
  using (
    exists (
      select 1
      from public.products p
      where p.id = packaging_units.product_id
        and public.is_pharmacy_member(p.pharmacy_id)
    )
  );

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------

create policy services_insert_members
  on public.services
  for insert
  with check (public.is_pharmacy_member(pharmacy_id));

create policy services_update_members
  on public.services
  for update
  using (public.is_pharmacy_member(pharmacy_id))
  with check (public.is_pharmacy_member(pharmacy_id));

create policy services_delete_members
  on public.services
  for delete
  using (public.is_pharmacy_member(pharmacy_id));

-- ---------------------------------------------------------------------------
-- pharmacies and pharmacy_members remain read-only (SELECT-only) — this
-- migration intentionally does not add write policies for them. Phase 2B's
-- scope is catalogue CRUD only.
-- ---------------------------------------------------------------------------
