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

export type PharmacyRole = Database["public"]["Enums"]["pharmacy_role"];

/**
 * Changes a member's role or active status. The caller must be an active
 * owner. The database function repeats the authorization check and prevents
 * removal of the pharmacy's last active owner.
 */
export async function updatePharmacyMember(
  targetUserId: string,
  newRole: PharmacyRole,
  newIsActive: boolean,
  client?: SupabaseClient<Database>,
): Promise<PharmacyMemberDirectoryRow> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId, role } = await requirePharmacyContext(resolvedClient);

  if (role !== "owner") {
    throw new Error("Only pharmacy owners can manage team members.");
  }

  const { data, error } = await resolvedClient.rpc("update_pharmacy_member", {
    target_pharmacy_id: pharmacyId,
    target_user_id: targetUserId,
    new_role: newRole,
    new_is_active: newIsActive,
  });

  if (error) {
    if (
      error.code === "23514" &&
      error.message === "The last active owner cannot be demoted or deactivated."
    ) {
      throw new Error("The last active owner cannot be demoted or deactivated.");
    }

    throw new Error("Unable to update member access. Please try again.");
  }

  const updatedMember = data?.[0];
  if (!updatedMember) {
    throw new Error("The member update did not return a result.");
  }

  return updatedMember;
}

export type PharmacyMemberAuditRow =
  Database["public"]["Functions"]["list_pharmacy_member_audit"]["Returns"][number];

/** Latest access changes, scoped to the authenticated owner's pharmacy. */
export async function listPharmacyMemberAudit(
  client?: SupabaseClient<Database>,
): Promise<PharmacyMemberAuditRow[]> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId, role } = await requirePharmacyContext(resolvedClient);

  if (role !== "owner") {
    throw new Error("Only pharmacy owners can view access history.");
  }

  const { data, error } = await resolvedClient.rpc("list_pharmacy_member_audit", {
    target_pharmacy_id: pharmacyId,
  });

  if (error) {
    throw new Error("Unable to load access history. Please try again.");
  }

  return data ?? [];
}
