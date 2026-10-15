import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { closeDaySchema, daySummarySchema, type CloseDayInput } from "./day-closing-schema";

async function closingContext() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to access daily reconciliation.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);

  if (context.role !== "owner" && context.role !== "accountant") {
    throw new Error("Only an active owner or accountant can access daily reconciliation.");
  }

  return { client, context };
}

export async function getPharmacyDaySummary() {
  const { client, context } = await closingContext();

  // Let the database resolve the current Lagos business date.
  const { data, error } = await client.rpc("get_pharmacy_day_summary", {
    target_pharmacy_id: context.pharmacyId,
  });

  if (error || !data) {
    throw new Error("Unable to load daily reconciliation. Please try again.");
  }

  const parsed = daySummarySchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Daily reconciliation returned an invalid response.");
  }

  return {
    ...parsed.data,
    pharmacyId: context.pharmacyId,
    userId: context.userId,
    role: context.role,
  };
}

export type DayClosingResult =
  { status: "confirmed"; closureId: string } | { status: "rejected"; message: string };

export async function closePharmacyDay(input: CloseDayInput): Promise<DayClosingResult> {
  const closing = closeDaySchema.parse(input);
  const { client, context } = await closingContext();

  const { data, error } = await client.rpc("close_pharmacy_day", {
    target_pharmacy_id: context.pharmacyId,
    operation_id: closing.operation_id,
    target_date: closing.business_date,
    opening_cash_amount: closing.opening_cash,
    counted_cash_amount: closing.counted_cash,
    closure_notes: closing.notes,
    reviewed_totals: closing.reviewed_totals,
  });

  if (error) {
    const expectedMessages: Record<string, readonly string[]> = {
      "22023": [
        "Valid closing details are required.",
        "Cash amounts must be non-negative with at most two decimal places.",
        "This submission reference was already used for a different closing.",
        "Only the current Lagos business day can be closed.",
        "This business day is already closed.",
        "Daily totals exceed the supported closing amount.",
        "Daily totals have changed. Refresh and review before closing.",
      ],
      "42501": [
        "Please sign in to close the day.",
        "Active pharmacy not found.",
        "Only an active owner or accountant can close the day.",
      ],
    };

    if (expectedMessages[error.code]?.includes(error.message)) {
      return { status: "rejected", message: error.message };
    }

    throw new Error("Unable to confirm closing. Please retry the same saved submission.");
  }

  if (!data) throw new Error("Daily closing did not return a result.");
  return { status: "confirmed", closureId: data };
}
