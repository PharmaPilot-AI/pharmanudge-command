import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database } from "../supabase/database.types";

export type PharmacyInventoryRow =
  Database["public"]["Functions"]["list_pharmacy_inventory"]["Returns"][number];

/** Pharmacy scope comes from the authenticated membership, never client input. */
export async function listPharmacyInventory(): Promise<PharmacyInventoryRow[]> {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to view inventory.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  const { data, error } = await client.rpc("list_pharmacy_inventory", {
    target_pharmacy_id: context.pharmacyId,
  });

  if (error) {
    throw new Error("Unable to load inventory. Please try again.");
  }

  return data ?? [];
}
