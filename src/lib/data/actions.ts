import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { daySummarySchema } from "./day-closing-schema";
import { savedActionSchema, updateActionSchema, type UpdateActionInput } from "./action-schema";

async function actionContext() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to access pharmacy actions.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (context.role !== "owner") {
    throw new Error("Only an active owner can manage pharmacy actions.");
  }
  return { client, context };
}

async function loadAll<T>(
  load: (offset: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const result = await load(rows.length);
    if (result.error || !result.data) {
      throw new Error("Unable to load the complete action queue or member list.");
    }
    rows.push(...result.data);
    if (result.data.length < 200) return rows;
  }
}

export async function getPharmacyActionQueue() {
  const { client, context } = await actionContext();

  // Obtain the business date from the database, then pin all pages to it.
  const dayResult = await client.rpc("get_pharmacy_day_summary", {
    target_pharmacy_id: context.pharmacyId,
  });
  if (dayResult.error) {
    throw new Error("Unable to determine the action queue business date.");
  }
  const day = daySummarySchema.safeParse(dayResult.data);
  if (!day.success) {
    throw new Error("The action queue returned an invalid business date.");
  }
  const date = day.data.business_date;

  const [rows, members] = await Promise.all([
    loadAll((offset) =>
      client
        .rpc("list_pharmacy_actions", {
          target_pharmacy_id: context.pharmacyId,
          target_date: date,
        })
        .range(offset, offset + 199),
    ),
    loadAll((offset) =>
      client
        .rpc("list_pharmacy_members", {
          target_pharmacy_id: context.pharmacyId,
        })
        .range(offset, offset + 199),
    ),
  ]);

  const actions = rows.map((row) => ({
    ...savedActionSchema.parse(row),
    source_snapshot: row.source_snapshot,
  }));

  return {
    actions,
    members,
    date,
    pharmacyId: context.pharmacyId,
    userId: context.userId,
  };
}

export async function refreshPharmacyActions() {
  const { client, context } = await actionContext();
  const { data, error } = await client.rpc("refresh_pharmacy_actions", {
    target_pharmacy_id: context.pharmacyId,
  });
  if (error || data === null) {
    throw new Error("Unable to refresh pharmacy risks. Please try again.");
  }
  return { count: data };
}

export type ActionUpdateResult =
  { status: "confirmed"; version: string } | { status: "rejected"; message: string };

export async function updatePharmacyAction(input: UpdateActionInput): Promise<ActionUpdateResult> {
  const update = updateActionSchema.parse(input);
  const { client, context } = await actionContext();

  const { data, error } = await client.rpc("update_pharmacy_action", {
    target_pharmacy_id: context.pharmacyId,
    target_action_id: update.action_id,
    expected_version: Number(update.expected_version),
    action_command: update.command,
    ...(update.assigned_user_id === undefined ? {} : { assigned_user_id: update.assigned_user_id }),
  });

  if (error) {
    const expected = [
      "Valid action update details are required.",
      "Action not found in this pharmacy.",
      "This action is no longer current. Refresh the action queue.",
      "This action has changed. Refresh before updating it.",
      "Choose an active member of this pharmacy.",
      "Snoozing beyond the supported date range is not available.",
    ];
    if (error.code === "22023" && expected.includes(error.message)) {
      return { status: "rejected", message: error.message };
    }
    if (
      error.code === "42501" &&
      error.message === "Only an active owner can manage pharmacy actions."
    ) {
      return { status: "rejected", message: error.message };
    }
    throw new Error(
      "The action update could not be confirmed. Reload the queue before trying again.",
    );
  }

  if (!data) {
    throw new Error("The action update returned no result. Reload the queue.");
  }
  return { status: "confirmed", version: data };
}
