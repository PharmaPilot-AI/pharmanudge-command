import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { expiryCutoff, isValidCalendarDate } from "../opening-stock";
import type { Database } from "../supabase/database.types";
import type { OpeningStockLotMetadata } from "../opening-stock-display";
export type { OpeningStockLotMetadata } from "../opening-stock-display";

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

export type PharmacyStockBatchRow =
  Database["public"]["Functions"]["list_pharmacy_stock_batches"]["Returns"][number] & {
    opening?: OpeningStockLotMetadata;
  };

// Narrow bridge for the draft RPC only; generated legacy Database types stay unchanged.
interface OpeningMetadataRpc {
  rpc(
    name: "list_opening_stock_lot_metadata",
    args: {
      target_pharmacy_id: string;
      after_batch_id: string | null;
      page_limit: number;
    },
  ): PromiseLike<{ data: unknown; error: unknown }>;
}
const METADATA_UNAVAILABLE =
  "Opening-stock reporting unavailable. Ask your administrator to review schema compatibility; no partial stock report can be shown.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_METADATA_PAGES = 400;
const MAX_METADATA_ROWS = 100000;
function validDate(value: unknown): value is string {
  return typeof value === "string" && isValidCalendarDate(value);
}
function parseMetadata(value: unknown, pharmacyId: string): OpeningStockLotMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(METADATA_UNAVAILABLE);
  const row = value as { [Key in keyof OpeningStockLotMetadata | "pharmacy_id"]?: unknown };
  if (
    typeof row.batch_id !== "string" ||
    !UUID.test(row.batch_id) ||
    typeof row.internal_lot_reference !== "string" ||
    !row.internal_lot_reference.trim() ||
    row.internal_lot_reference !== row.internal_lot_reference.trim() ||
    row.internal_lot_reference.length > 50 ||
    typeof row.batch_unknown !== "boolean" ||
    (row.batch_unknown
      ? row.manufacturer_batch !== null
      : typeof row.manufacturer_batch !== "string" ||
        !row.manufacturer_batch.trim() ||
        row.manufacturer_batch !== row.manufacturer_batch.trim() ||
        row.manufacturer_batch.length > 100) ||
    (row.expiry_precision !== "month" && row.expiry_precision !== "day") ||
    !validDate(row.expiry_cutoff_date) ||
    !validDate(row.physical_count_date) ||
    typeof row.expiry_label !== "string" ||
    ("pharmacy_id" in row && row.pharmacy_id !== pharmacyId)
  )
    throw new Error(METADATA_UNAVAILABLE);
  try {
    // Writer and reader share one calendar contract; retain either original label spelling.
    if (expiryCutoff(row.expiry_precision, row.expiry_label) !== row.expiry_cutoff_date)
      throw new Error(METADATA_UNAVAILABLE);
  } catch {
    throw new Error(METADATA_UNAVAILABLE);
  }
  return {
    batch_id: row.batch_id,
    internal_lot_reference: row.internal_lot_reference,
    batch_unknown: row.batch_unknown,
    manufacturer_batch: row.manufacturer_batch as string | null,
    expiry_precision: row.expiry_precision,
    expiry_label: row.expiry_label,
    expiry_cutoff_date: row.expiry_cutoff_date,
    physical_count_date: row.physical_count_date,
  };
}

async function loadOpeningMetadata(client: OpeningMetadataRpc, pharmacyId: string) {
  const rows = new Map<string, OpeningStockLotMetadata>();
  let cursor: string | null = null;
  try {
    for (let page = 0; page < MAX_METADATA_PAGES; page++) {
      const { data, error } = await client.rpc("list_opening_stock_lot_metadata", {
        target_pharmacy_id: pharmacyId,
        after_batch_id: cursor,
        page_limit: 250,
      });
      if (error || !Array.isArray(data) || data.length > 250) throw new Error(METADATA_UNAVAILABLE);
      // A short page is NOT completion: the server may cap below our requested limit.
      if (data.length === 0) return rows;
      for (const value of data) {
        const row = parseMetadata(value, pharmacyId);
        if ((cursor !== null && row.batch_id <= cursor) || rows.size >= MAX_METADATA_ROWS)
          throw new Error(METADATA_UNAVAILABLE);
        rows.set(row.batch_id, row);
        cursor = row.batch_id;
      }
    }
  } catch {
    throw new Error(METADATA_UNAVAILABLE);
  }
  throw new Error(METADATA_UNAVAILABLE);
}

/** Returns remaining batches from the authenticated caller's pharmacy. */
export async function listPharmacyStockBatches(): Promise<PharmacyStockBatchRow[]> {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to view stock batches.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  const { data, error } = await client.rpc("list_pharmacy_stock_batches", {
    target_pharmacy_id: context.pharmacyId,
  });

  if (error) throw new Error("Unable to load stock batches. Please try again.");
  const opening = await loadOpeningMetadata(
    client as unknown as OpeningMetadataRpc,
    context.pharmacyId,
  );
  return (data ?? []).map((batch) => {
    const metadata = opening.get(batch.batch_id);
    if (!metadata) return batch;
    if (metadata.expiry_cutoff_date !== batch.expiry_date) throw new Error(METADATA_UNAVAILABLE);
    return { ...batch, opening: metadata };
  });
}
