import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database, Tables, TablesInsert, TablesUpdate } from "../supabase/database.types";

/**
 * Lists active packaging units for one product belonging to the caller's own
 * pharmacy. Read-only. packaging_units has no pharmacy_id column, so scoping
 * is enforced via an inner join back to products.pharmacy_id, in addition to
 * RLS. Throws on auth/context or query failure rather than returning an
 * empty/misleading list.
 */
export async function listPackagingUnitsForProduct(
  productId: string,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"packaging_units">[]> {
  const { pharmacyId } = await requirePharmacyContext(client);

  const { data, error } = await client
    .from("packaging_units")
    .select("*, products!inner(pharmacy_id)")
    .eq("product_id", productId)
    .eq("products.pharmacy_id", pharmacyId)
    .eq("is_active", true)
    .order("label");

  if (error) throw error;
  return data.map(({ products: _products, ...unit }) => unit);
}

/**
 * Verifies that a product belongs to the given pharmacy. Throws if not
 * found or not owned — used before any packaging-unit write, since
 * packaging_units has no pharmacy_id column of its own and ownership is
 * only reachable via product_id.
 */
async function assertOwnedProduct(
  client: SupabaseClient<Database>,
  productId: string,
  pharmacyId: string,
): Promise<void> {
  const { data, error } = await client
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("pharmacy_id", pharmacyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Product not found for this pharmacy.");
}

/**
 * Fetches a packaging unit only if its product belongs to the given
 * pharmacy. Throws otherwise — used before update/delete so those
 * operations never touch a unit whose product isn't owned by the caller.
 */
async function getOwnedPackagingUnit(
  client: SupabaseClient<Database>,
  packagingUnitId: string,
  pharmacyId: string,
): Promise<Tables<"packaging_units">> {
  const { data, error } = await client
    .from("packaging_units")
    .select("*, products!inner(pharmacy_id)")
    .eq("id", packagingUnitId)
    .eq("products.pharmacy_id", pharmacyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Packaging unit not found for this pharmacy.");
  const { products: _products, ...unit } = data;
  return unit;
}

/**
 * Creates a packaging unit for a product owned by the caller's own
 * pharmacy. The referenced product's ownership is verified explicitly
 * before the insert — this is what prevents a Pharmacy A caller from
 * attaching a packaging unit to Pharmacy B's product, independent of the
 * RLS policy that also enforces this.
 */
export async function createPackagingUnit(
  input: Omit<TablesInsert<"packaging_units">, "id" | "created_at" | "updated_at">,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"packaging_units">> {
  const { pharmacyId } = await requirePharmacyContext(client);
  await assertOwnedProduct(client, input.product_id, pharmacyId);

  const { data, error } = await client.from("packaging_units").insert(input).select().single();

  if (error) throw error;
  return data;
}

/**
 * Updates a packaging unit, explicitly scoped to a product owned by the
 * caller's own pharmacy in addition to RLS. product_id and id are
 * structurally excluded from the input type — a packaging unit can never
 * be re-pointed at a different product (in particular, never at another
 * pharmacy's product) through this function.
 */
export async function updatePackagingUnit(
  packagingUnitId: string,
  input: Partial<
    Omit<TablesUpdate<"packaging_units">, "id" | "product_id" | "created_at" | "updated_at">
  >,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"packaging_units">> {
  const { pharmacyId } = await requirePharmacyContext(client);
  await getOwnedPackagingUnit(client, packagingUnitId, pharmacyId);

  const { data, error } = await client
    .from("packaging_units")
    .update(input)
    .eq("id", packagingUnitId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes a packaging unit, explicitly scoped to a product owned by the
 * caller's own pharmacy in addition to RLS.
 */
export async function deletePackagingUnit(
  packagingUnitId: string,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<void> {
  const { pharmacyId } = await requirePharmacyContext(client);
  await getOwnedPackagingUnit(client, packagingUnitId, pharmacyId);

  const { error } = await client.from("packaging_units").delete().eq("id", packagingUnitId);

  if (error) throw error;
}
