import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { stockReceiptSchema, type StockReceiptInput } from "./stock-receipt-schema";

export async function confirmStockReceipt(input: StockReceiptInput): Promise<string> {
  const receipt = stockReceiptSchema.parse(input);
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to receive stock.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
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
