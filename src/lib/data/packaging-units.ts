import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database, Tables } from "../supabase/database.types";

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
