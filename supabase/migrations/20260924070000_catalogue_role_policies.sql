-- Restrict catalogue writes to active owners and pharmacists.

create or replace function public.can_manage_catalogue(target_pharmacy_id uuid)
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
      and m.role in ('owner', 'pharmacist')
      and m.is_active = true
      and p.is_active = true
  );
$$;

revoke execute on function public.can_manage_catalogue(uuid) from public;
revoke execute on function public.can_manage_catalogue(uuid) from anon;
grant execute on function public.can_manage_catalogue(uuid) to authenticated;

drop policy if exists products_insert_members on public.products;
drop policy if exists products_update_members on public.products;
drop policy if exists products_delete_members on public.products;

create policy products_insert_catalogue_managers
  on public.products for insert
  with check (public.can_manage_catalogue(pharmacy_id));

create policy products_update_catalogue_managers
  on public.products for update
  using (public.can_manage_catalogue(pharmacy_id))
  with check (public.can_manage_catalogue(pharmacy_id));

create policy products_delete_catalogue_managers
  on public.products for delete
  using (public.can_manage_catalogue(pharmacy_id));

drop policy if exists packaging_units_insert_members on public.packaging_units;
drop policy if exists packaging_units_update_members on public.packaging_units;
drop policy if exists packaging_units_delete_members on public.packaging_units;

create policy packaging_units_insert_catalogue_managers
  on public.packaging_units for insert
  with check (
    exists (
      select 1 from public.products p
      where p.id = packaging_units.product_id
        and public.can_manage_catalogue(p.pharmacy_id)
    )
  );

create policy packaging_units_update_catalogue_managers
  on public.packaging_units for update
  using (
    exists (
      select 1 from public.products p
      where p.id = packaging_units.product_id
        and public.can_manage_catalogue(p.pharmacy_id)
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = packaging_units.product_id
        and public.can_manage_catalogue(p.pharmacy_id)
    )
  );

create policy packaging_units_delete_catalogue_managers
  on public.packaging_units for delete
  using (
    exists (
      select 1 from public.products p
      where p.id = packaging_units.product_id
        and public.can_manage_catalogue(p.pharmacy_id)
    )
  );

drop policy if exists services_insert_members on public.services;
drop policy if exists services_update_members on public.services;
drop policy if exists services_delete_members on public.services;

create policy services_insert_catalogue_managers
  on public.services for insert
  with check (public.can_manage_catalogue(pharmacy_id));

create policy services_update_catalogue_managers
  on public.services for update
  using (public.can_manage_catalogue(pharmacy_id))
  with check (public.can_manage_catalogue(pharmacy_id));

create policy services_delete_catalogue_managers
  on public.services for delete
  using (public.can_manage_catalogue(pharmacy_id));
