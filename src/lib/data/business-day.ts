import "@tanstack/react-start/server-only";
import { z } from "zod";
import { setResponseHeader } from "@tanstack/react-start/server";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";

const businessDayStatusSchema = z
  .object({ business_date: z.string().date(), is_closed: z.boolean() })
  .strict();

/** Requires the separately approved/applied status RPC; never falls back to an open day. */
export async function getPharmacyBusinessDayStatus() {
  setResponseHeader("Cache-Control", "no-store");
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to access business-day status.");
  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (!["owner", "pharmacist", "cashier", "accountant"].includes(context.role)) {
    throw new Error("Only an active pharmacy member can access business-day status.");
  }

  // No caller-supplied pharmacy or date: the DB owns the current Lagos day.
  const unavailable = "Unable to load business-day status. Please try again.";
  let response;
  try {
    response = await client.rpc("get_pharmacy_business_day_status", {
      target_pharmacy_id: context.pharmacyId,
    });
  } catch {
    throw new Error(unavailable);
  }
  if (response.error) throw new Error(unavailable);
  const parsed = businessDayStatusSchema.safeParse(response.data);
  if (!parsed.success) throw new Error("Business-day status returned an invalid response.");
  return {
    ...parsed.data,
    pharmacyId: context.pharmacyId,
    userId: context.userId,
  };
}
