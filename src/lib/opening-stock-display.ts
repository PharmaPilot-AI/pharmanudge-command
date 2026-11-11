/** Supplemental provenance; never substitutes the internal reference for a manufacturer batch. */
export interface OpeningStockLotMetadata {
  batch_id: string;
  internal_lot_reference: string;
  batch_unknown: boolean;
  manufacturer_batch: string | null;
  expiry_precision: "month" | "day";
  expiry_label: string;
  expiry_cutoff_date: string;
  physical_count_date: string;
}

interface StockLotDisplayInput {
  batch_number: string;
  supplier_name: string;
  expiry_date: string;
  days_to_expiry: number;
  opening?: OpeningStockLotMetadata;
}

/** Calendar-only arithmetic, independent of local time, DST or the render timezone. */
export function previousCalendarDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid stock lot date.");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid stock lot date.");
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Legacy deliveries keep their existing exact-day labels and countdown semantics. */
export function describeStockLot(batch: StockLotDisplayInput) {
  const opening = batch.opening;
  const days = batch.days_to_expiry;
  return {
    source: opening ? "Opening stock" : batch.supplier_name,
    manufacturerBatch: opening
      ? opening.batch_unknown
        ? "Manufacturer batch unknown"
        : `Manufacturer batch ${opening.manufacturer_batch}`
      : `Batch ${batch.batch_number}`,
    internalLotReference: opening?.internal_lot_reference ?? null,
    physicalCountDate: opening?.physical_count_date ?? null,
    expiryLabel: opening?.expiry_label ?? batch.expiry_date,
    expiryPrecision: opening?.expiry_precision ?? "day",
    unavailableFrom: opening?.expiry_cutoff_date ?? null,
    usableThrough:
      opening?.expiry_precision === "month"
        ? previousCalendarDay(opening.expiry_cutoff_date)
        : null,
    countdown: opening
      ? days <= 0
        ? days === 0
          ? "Unavailable from today"
          : `Unavailable for ${Math.abs(days)} days`
        : `Unavailable in ${days} ${days === 1 ? "day" : "days"}`
      : days === 0
        ? "Expired today"
        : days < 0
          ? `Expired ${Math.abs(days)} days ago`
          : `${days} days remaining`,
  };
}
