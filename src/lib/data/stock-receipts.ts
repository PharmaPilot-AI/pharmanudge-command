import "@tanstack/react-start/server-only";
import { CATALOGUE_PAGE_SIZE, loadCatalogueRows } from "./catalogue-pages";
import { resolveSessionUser } from "../auth/context";
import { listProducts } from "./products";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { receiptSubmissionSchema, type ReceiptSubmission } from "./stock-receipt-schema";

export async function confirmStockReceipt(input: ReceiptSubmission): Promise<string> {
  const submission = receiptSubmissionSchema.parse(input);
  const receipt = submission.request;
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to receive stock.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (submission.pharmacyId !== context.pharmacyId || submission.userId !== context.userId) {
    throw new Error(
      "This saved receipt belongs to a different user or pharmacy. Return to its original context to reconcile it.",
    );
  }
  if (context.role !== "owner" && context.role !== "pharmacist") {
    throw new Error("Only an active owner or pharmacist can receive stock.");
  }

  const { data, error } = await client.rpc("confirm_stock_receipt", {
    target_pharmacy_id: context.pharmacyId,
    operation_id: receipt.operation_id,
    receipt_supplier: receipt.supplier_name,
    receipt_invoice: receipt.invoice_reference,
    receipt_items: receipt.items,
  });

  if (error) {
    const expectedMessages: Record<string, readonly string[]> = {
      "22023": [
        "Valid receipt details are required.",
        "A receipt must contain between 1 and 100 items.",
        "Receipt quantity, cost, batch or expiry is invalid.",
        "Stock expiry must be after today.",
        "This submission reference was already used for a different receipt.",
      ],
      P0001: [
        "An active product was not found in this pharmacy.",
        "An active packaging unit was not found for this product.",
      ],
      "42501": [
        "Please sign in to receive stock.",
        "Only an active owner or pharmacist can receive stock.",
      ],
    };

    if (expectedMessages[error.code]?.includes(error.message)) {
      throw new Error(error.message);
    }
    throw new Error("Unable to confirm stock receipt. Please try again.");
  }

  if (!data) throw new Error("The receipt confirmation did not return a result.");
  return data;
}

/** Real catalogue for authorized stock-receiving staff. */
export async function getStockReceiptCatalogue() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to receive stock.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (context.role !== "owner" && context.role !== "pharmacist") {
    throw new Error("Only an active owner or pharmacist can receive stock.");
  }

  const [products, unitRows] = await Promise.all([
    listProducts(client),
    loadCatalogueRows(
      (afterId) => {
        let query = client
          .from("packaging_units")
          .select(
            "id, product_id, label, base_units_per_unit, products!inner(pharmacy_id, is_active)",
          )
          .eq("is_active", true)
          .eq("products.pharmacy_id", context.pharmacyId)
          .eq("products.is_active", true)
          .order("id")
          .limit(CATALOGUE_PAGE_SIZE);
        if (afterId !== null) query = query.gt("id", afterId);
        return query;
      },
      (row) => row.id,
    ),
  ]);

  unitRows.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  const units = unitRows.map((unit) => ({
    id: unit.id,
    product_id: unit.product_id,
    label: unit.label,
    base_units_per_unit: unit.base_units_per_unit,
  }));

  return { products, units };
}
