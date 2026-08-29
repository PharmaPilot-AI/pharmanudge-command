import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database, Tables, TablesInsert, TablesUpdate } from "../supabase/database.types";

/**
 * Lists active products for the caller's own pharmacy. Read-only. Scoped by
 * an explicit pharmacy_id filter in addition to RLS. Throws on auth/context
 * or query failure rather than returning an empty/misleading list.
 */
export async function listProducts(
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"products">[]> {
  const { pharmacyId } = await requirePharmacyContext(client);

  const { data, error } = await client
    .from("products")
    .select("*")
    .eq("pharmacy_id", pharmacyId)
    .eq("is_active", true)
    .order("name");

  if (error) throw error;
  return data;
}

/**
 * Creates a product for the caller's own pharmacy. pharmacy_id is derived
 * from the authenticated pharmacy context and is never accepted from input
 * — the input type structurally excludes it.
 */
export async function createProduct(
  input: Omit<TablesInsert<"products">, "pharmacy_id">,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"products">> {
  const { pharmacyId } = await requirePharmacyContext(client);

  const { data, error } = await client
    .from("products")
    .insert({ ...input, pharmacy_id: pharmacyId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Updates a product, explicitly scoped to the caller's own pharmacy in
 * addition to RLS. pharmacy_id and id are structurally excluded from the
 * input type — neither can be changed via this function.
 */
export async function updateProduct(
  productId: string,
  input: Partial<Omit<TablesUpdate<"products">, "pharmacy_id" | "id">>,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<Tables<"products">> {
  const { pharmacyId } = await requirePharmacyContext(client);

  const { data, error } = await client
    .from("products")
    .update(input)
    .eq("id", productId)
    .eq("pharmacy_id", pharmacyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes a product, explicitly scoped to the caller's own pharmacy in
 * addition to RLS. Throws if no matching row was deleted (not found, or
 * not owned by this pharmacy) rather than silently succeeding.
 */
export async function deleteProduct(
  productId: string,
  client: SupabaseClient<Database> = createServerSupabaseClient(),
): Promise<void> {
  const { pharmacyId } = await requirePharmacyContext(client);

  const { data, error } = await client
    .from("products")
    .delete()
    .eq("id", productId)
    .eq("pharmacy_id", pharmacyId)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Product not found for this pharmacy.");
  }
}
