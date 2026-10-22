import type { stockReceiptCatalogueQuery } from "./validation";
import type { ReceiptScope } from "./pending-stock-receipt";

export type ReceiptCatalogueData = Awaited<ReturnType<typeof stockReceiptCatalogueQuery>>;
export type ReceiptCatalogueState = ReceiptScope &
  ({ status: "available"; data: ReceiptCatalogueData } | { status: "unavailable" });

export const RECEIPT_CATALOGUE_UNAVAILABLE =
  "Receiving catalogue is unavailable. New delivery entry is blocked; saved submissions can still be reconciled.";

export function unavailableReceiptCatalogue(scope: ReceiptScope): ReceiptCatalogueState {
  return { pharmacyId: scope.pharmacyId, userId: scope.userId, status: "unavailable" };
}

/** Never treat failure or a response from another identity as an empty usable catalogue. */
export async function readReceiptCatalogue(
  scope: ReceiptScope,
  query: () => Promise<ReceiptCatalogueData>,
): Promise<ReceiptCatalogueState> {
  try {
    const data = await query();
    if (
      data.pharmacyId !== scope.pharmacyId ||
      data.userId !== scope.userId ||
      !Array.isArray(data.products) ||
      !Array.isArray(data.units)
    )
      return unavailableReceiptCatalogue(scope);
    return { ...scope, status: "available", data };
  } catch {
    return unavailableReceiptCatalogue(scope);
  }
}

/** Router cache/late loader data cannot seed another identity's receiving form. */
export function receiptCatalogueForScope(
  state: ReceiptCatalogueState | undefined,
  scope: ReceiptScope,
): ReceiptCatalogueState {
  if (
    state?.status === "available" &&
    state.pharmacyId === scope.pharmacyId &&
    state.userId === scope.userId &&
    state.data.pharmacyId === scope.pharmacyId &&
    state.data.userId === scope.userId
  )
    return state;
  return unavailableReceiptCatalogue(scope);
}
