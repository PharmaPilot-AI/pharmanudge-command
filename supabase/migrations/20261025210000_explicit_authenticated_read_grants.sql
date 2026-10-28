-- Explicit read access for tables queried directly by the application.
-- Existing RLS policies continue to control which rows are visible.
-- No anonymous access or additional write privileges are granted.
grant select on table
  public.pharmacies,
  public.pharmacy_members,
  public.products,
  public.packaging_units,
  public.services
to authenticated;
