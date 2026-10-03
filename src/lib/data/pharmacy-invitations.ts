import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database } from "../supabase/database.types";

export type PharmacyInvitationRow =
  Database["public"]["Functions"]["list_pharmacy_invitations"]["Returns"][number];

export type PharmacyInvitationRole = Exclude<Database["public"]["Enums"]["pharmacy_role"], "owner">;

async function resolveOwner() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to manage invitations.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (context.role !== "owner") {
    throw new Error("Only pharmacy owners can manage invitations.");
  }

  return { client, pharmacyId: context.pharmacyId };
}

export async function listPharmacyInvitations(): Promise<PharmacyInvitationRow[]> {
  const { client, pharmacyId } = await resolveOwner();
  const { data, error } = await client.rpc("list_pharmacy_invitations", {
    target_pharmacy_id: pharmacyId,
  });

  if (error) throw new Error("Unable to load invitations. Please try again.");
  return data ?? [];
}

export async function createPharmacyInvitation(
  email: string,
  role: PharmacyInvitationRole,
): Promise<string> {
  const { client, pharmacyId } = await resolveOwner();
  const { data, error } = await client.rpc("create_pharmacy_invitation", {
    target_pharmacy_id: pharmacyId,
    invitation_email: email.trim().toLowerCase(),
    invitation_role: role,
  });

  if (error) {
    const expectedMessages = [
      "This email already belongs to a pharmacy member.",
      "A pending invitation already exists for this email.",
    ];

    if (error.code === "P0001" && expectedMessages.includes(error.message)) {
      throw new Error(error.message);
    }

    throw new Error("Unable to create invitation. Please try again.");
  }

  if (!data) throw new Error("The invitation did not return a result.");
  return data;
}

export async function cancelPharmacyInvitation(id: string): Promise<string> {
  const { client, pharmacyId } = await resolveOwner();
  const { data, error } = await client.rpc("cancel_pharmacy_invitation", {
    target_pharmacy_id: pharmacyId,
    target_invitation_id: id,
  });

  if (error) {
    if (error.code === "P0001" && error.message === "Pending invitation not found.") {
      throw new Error("This invitation is no longer pending. Refresh the page.");
    }

    throw new Error("Unable to cancel invitation. Please try again.");
  }

  if (!data) throw new Error("The cancellation did not return a result.");
  return data;
}
