import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database, Tables } from "../supabase/database.types";

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
