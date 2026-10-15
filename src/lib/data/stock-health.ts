import "@tanstack/react-start/server-only";
import { z } from "zod";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";

const count = z.string().regex(/^\d+$/);

const stockHealthSchema = z
  .object({
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    active_products: count,
    out_of_stock_products: count,
    expiring_batches: count,
    expired_batches: count,
    low_stock_products: z.null(),
  })
  .strict();

export async function getPharmacyStockHealth() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to view dashboard stock health.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);

  if (context.role !== "owner") {
    throw new Error("Only an active owner can view dashboard stock health.");
  }

  const { data, error } = await client.rpc("get_pharmacy_stock_health", {
    target_pharmacy_id: context.pharmacyId,
  });

  if (error || !data) {
    throw new Error("Unable to load stock health. Please try again.");
  }

  const parsed = stockHealthSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Stock health returned an invalid response.");
  }

  return parsed.data;
}
