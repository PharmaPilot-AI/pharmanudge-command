import { createServerFn } from "@tanstack/react-start";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import {
  openingStockSchema,
  openingStockSubmissionSchema,
  type OpeningStockItem,
  type OpeningStockSubmission,
} from "./opening-stock-schema";

/** Narrow adapter until generated types include the opening-only RPC. No other untyped RPCs. */
type OpeningStockRpcClient = {
  rpc: (
    name: "confirm_opening_stock",
    args: {
      target_pharmacy_id: string;
      operation_id: string;
      physical_count_date: string;
      opening_items: OpeningStockItem[];
    },
  ) => PromiseLike<{ data: unknown; error: { code: string; message: string } | null }>;
};

export async function confirmOpeningStock(input: OpeningStockSubmission): Promise<string> {
  // Parse again here, not only in the mutation validator: server date and scope are authoritative.
  const submission = openingStockSubmissionSchema.parse(input);
  const request = submission.request;
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to record opening stock.");
  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (submission.pharmacyId !== context.pharmacyId || submission.userId !== context.userId) {
    throw new Error(
      "This saved opening stock belongs to a different user or pharmacy. Return to its original context to reconcile it.",
    );
  }
  if (context.role !== "owner" && context.role !== "pharmacist") {
    throw new Error("Only an active owner or pharmacist can record opening stock.");
  }
  const rpcClient = client as unknown as OpeningStockRpcClient;
  const { data, error } = await rpcClient.rpc("confirm_opening_stock", {
    target_pharmacy_id: context.pharmacyId,
    operation_id: request.operation_id,
    physical_count_date: request.physical_count_date,
    opening_items: request.items,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new Error(
        "Opening stock is not available on this server yet. Keep the saved submission and contact your administrator.",
      );
    }
    // Do not leak schema, SQL, or unrelated server error details. The durable outbox remains retryable.
    throw new Error("Unable to confirm opening stock. Keep the saved submission and try again.");
  }
  const reference = openingStockSchema.shape.operation_id.safeParse(data);
  if (!reference.success)
    throw new Error(
      "Opening stock confirmation did not return a valid reference. Retry the saved submission.",
    );
  return reference.data;
}

export const confirmOpeningStockMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => openingStockSubmissionSchema.parse(input))
  .handler(({ data }) => confirmOpeningStock(data));
