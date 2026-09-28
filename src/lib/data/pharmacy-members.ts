import "@tanstack/react-start/server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database } from "../supabase/database.types";

export type PharmacyMemberDirectoryRow =
  Database["public"]["Functions"]["list_pharmacy_members"]["Returns"][number];

async function resolveClient(client?: SupabaseClient<Database>): Promise<SupabaseClient<Database>> {
  return client ?? createServerSupabaseClient((await resolveSessionUser())?.accessToken);
}

/**
 * Lists real members of the caller's pharmacy. The application checks the
 * owner role before calling the owner-only database function, which performs
 * the authoritative owner check again.
 */
export async function listPharmacyMembers(
  client?: SupabaseClient<Database>,
): Promise<PharmacyMemberDirectoryRow[]> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId, role } = await requirePharmacyContext(resolvedClient);

  if (role !== "owner") {
    throw new Error("Only pharmacy owners can view team members.");
  }

  const { data, error } = await resolvedClient.rpc("list_pharmacy_members", {
    target_pharmacy_id: pharmacyId,
  });

  if (error) throw error;
  return data;
}
