import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import type { Database } from "./supabase/database.types";

export interface PharmacyContext {
  userId: string;
  pharmacyId: string;
  role: Database["public"]["Enums"]["pharmacy_role"];
}

/**
 * Resolves the calling user's active pharmacy membership and role.
 *
 * Fails closed (returns null) for: no authenticated user, no active
 * membership, an inactive pharmacy, or more than one matching active
 * membership (ambiguous). Relies entirely on RLS via the caller's session —
 * never uses service-role credentials.
 */
export async function getPharmacyContext(
  client: SupabaseClient<Database> = supabase,
): Promise<PharmacyContext | null> {
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return null;

  const { data, error } = await client
    .from("pharmacy_members")
    .select("pharmacy_id, role, pharmacies!inner(is_active)")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .eq("pharmacies.is_active", true);

  if (error || !data || data.length !== 1) return null;

  const membership = data[0]!;
  return {
    userId: userData.user.id,
    pharmacyId: membership.pharmacy_id,
    role: membership.role,
  };
}
