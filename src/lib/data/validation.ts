import { confirmPharmacySale, getPosCatalogue } from "./sales";
import { saleSchema } from "./sale-schema";
import { recordPharmacyExpense, listPharmacyExpenses } from "./expenses";
import { expenseSchema } from "./expense-schema";
import { getPharmacyDaySummary, closePharmacyDay } from "./day-closing";
import { closeDaySchema } from "./day-closing-schema";
import { getPharmacyFinancialSummary } from "./financial";
import { reportPeriodSchema } from "./financial-schema";
import { getPharmacyStockHealth } from "./stock-health";
import { getPharmacyActionQueue, refreshPharmacyActions, updatePharmacyAction } from "./actions";
import { updateActionSchema } from "./action-schema";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { listPharmacyInventory, listPharmacyStockBatches } from "./inventory";
import { confirmStockReceipt, getStockReceiptCatalogue } from "./stock-receipts";
import { receiptSubmissionSchema } from "./stock-receipt-schema";
import { createProduct, updateProduct, deleteProduct } from "./products";
import { createService, updateService, deleteService } from "./services";
import { createPackagingUnit, updatePackagingUnit, deletePackagingUnit } from "./packaging-units";
import { updatePharmacyMember, listPharmacyMemberAudit } from "./pharmacy-members";
import {
  listPharmacyInvitations,
  createPharmacyInvitation,
  cancelPharmacyInvitation,
  acceptPharmacyInvitation,
} from "./pharmacy-invitations";

/**
 * Checkpoint 3 — server mutation + validation foundation.
 *
 * One reusable pattern, applied to all three catalogue entities:
 *   createServerFn({ method: "POST" })
 *     .validator((input) => schema.parse(input))
 *     .handler(...)
 * wrapping the existing Checkpoint 2 DAL functions. No query/mutation logic
 * is duplicated here — every wrapper below only validates input and
 * delegates to the corresponding DAL function, which is solely responsible
 * for deriving pharmacy_id from the authenticated context, scoping
 * update/delete by it, and (for packaging units) verifying product
 * ownership. pharmacy_id and (for packaging units) product_id on update are
 * never fields in any schema below — the DAL's own types already exclude
 * them, and these schemas don't reintroduce them.
 *
 * Convention for callers (established here for Checkpoints 4–9 to follow,
 * not yet exercised since no route calls these): on a successful mutation,
 * call `router.invalidate()` (from `useRouter()`) to refresh the affected
 * route's loader data; on a rejected promise (validation failure or a
 * thrown DAL/database error), surface it via `toast.error(error.message)`.
 * Neither router nor toast is referenced in this file — both are
 * client-side concerns that belong in the calling route component.
 */

const idSchema = z.object({ id: z.string().uuid() });

/**
 * Removes keys whose value is `undefined`. Zod's `.optional()` types a
 * field as `T | undefined` (present-with-undefined allowed); the DAL's
 * `Partial<...>` input types, under this project's
 * `exactOptionalPropertyTypes`, require the key to be absent rather than
 * present-with-undefined. Parsed Zod output always includes optional keys
 * (set to `undefined` when omitted by the caller), so this bridges the two.
 */
function stripUndefined<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

// --- Products ---

const productCreateSchema = z.object({
  name: z.string().min(1),
  generic_name: z.string().optional(),
  category: z.string().optional(),
  barcode: z.string().nullable().optional(),
  base_unit_label: z.string().min(1),
  cost_per_base_unit: z.number().min(0).optional(),
  shelf_location: z.string().optional(),
});

const productUpdateSchema = idSchema.extend(productCreateSchema.partial().shape);

export const createProductMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => productCreateSchema.parse(input))
  .handler(({ data }) => createProduct(stripUndefined(data)));

export const updateProductMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => productUpdateSchema.parse(input))
  .handler(({ data }) => {
    const { id, ...fields } = data;
    return updateProduct(id, stripUndefined(fields));
  });

export const deleteProductMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(({ data }) => deleteProduct(data.id));

// --- Services ---

const serviceCreateSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
});

const serviceUpdateSchema = idSchema.extend(serviceCreateSchema.partial().shape);

export const createServiceMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => serviceCreateSchema.parse(input))
  .handler(({ data }) => createService(stripUndefined(data)));

export const updateServiceMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => serviceUpdateSchema.parse(input))
  .handler(({ data }) => {
    const { id, ...fields } = data;
    return updateService(id, stripUndefined(fields));
  });

export const deleteServiceMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(({ data }) => deleteService(data.id));

// --- Packaging units ---

const packagingUnitCreateSchema = z.object({
  product_id: z.string().uuid(),
  label: z.string().min(1),
  base_units_per_unit: z.number().int().min(1),
  price: z.number().min(0),
});

const packagingUnitUpdateSchema = idSchema.extend(
  packagingUnitCreateSchema.omit({ product_id: true }).partial().shape,
);

export const createPackagingUnitMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => packagingUnitCreateSchema.parse(input))
  .handler(({ data }) => createPackagingUnit(stripUndefined(data)));

export const updatePackagingUnitMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => packagingUnitUpdateSchema.parse(input))
  .handler(({ data }) => {
    const { id, ...fields } = data;
    return updatePackagingUnit(id, stripUndefined(fields));
  });

export const deletePackagingUnitMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(({ data }) => deletePackagingUnit(data.id));

// --- Pharmacy members ---

const pharmacyMemberUpdateSchema = z.object({
  target_user_id: z.string().uuid(),
  role: z.enum(["owner", "pharmacist", "cashier", "accountant"]),
  is_active: z.boolean(),
});

export const updatePharmacyMemberMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => pharmacyMemberUpdateSchema.parse(input))
  .handler(({ data }) => updatePharmacyMember(data.target_user_id, data.role, data.is_active));

// --- Pharmacy invitations ---

const pharmacyInvitationCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["pharmacist", "cashier", "accountant"]),
});

export const listPharmacyInvitationsQuery = createServerFn({ method: "GET" }).handler(() =>
  listPharmacyInvitations(),
);

export const createPharmacyInvitationMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => pharmacyInvitationCreateSchema.parse(input))
  .handler(({ data }) => createPharmacyInvitation(data.email, data.role));

export const cancelPharmacyInvitationMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(({ data }) => cancelPharmacyInvitation(data.id));

export const acceptPharmacyInvitationMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => idSchema.parse(input))
  .handler(({ data }) => acceptPharmacyInvitation(data.id));

export const listPharmacyMemberAuditQuery = createServerFn({ method: "GET" }).handler(() =>
  listPharmacyMemberAudit(),
);

// --- Stock receipts ---

export const confirmStockReceiptMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => receiptSubmissionSchema.parse(input))
  .handler(({ data }) => confirmStockReceipt(data));

export const stockReceiptCatalogueQuery = createServerFn({ method: "GET" }).handler(() =>
  getStockReceiptCatalogue(),
);

// --- Inventory ---

export const pharmacyInventoryQuery = createServerFn({ method: "GET" }).handler(() =>
  listPharmacyInventory(),
);

export const pharmacyStockBatchesQuery = createServerFn({ method: "GET" }).handler(() =>
  listPharmacyStockBatches(),
);

// --- POS sales ---

export const posCatalogueQuery = createServerFn({ method: "GET" }).handler(() => getPosCatalogue());

export const confirmPharmacySaleMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => saleSchema.parse(input))
  .handler(({ data }) => confirmPharmacySale(data));

// --- Expenses ---

export const pharmacyExpensesQuery = createServerFn({ method: "GET" }).handler(() =>
  listPharmacyExpenses(),
);

export const recordPharmacyExpenseMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => expenseSchema.parse(input))
  .handler(({ data }) => recordPharmacyExpense(data));

// --- Daily reconciliation ---

export const pharmacyDaySummaryQuery = createServerFn({ method: "GET" }).handler(() =>
  getPharmacyDaySummary(),
);

export const closePharmacyDayMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => closeDaySchema.parse(input))
  .handler(({ data }) => closePharmacyDay(data));

// --- Financial reporting ---

export const pharmacyFinancialSummaryQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => z.object({ period: reportPeriodSchema }).strict().parse(input))
  .handler(({ data }) => getPharmacyFinancialSummary(data.period));

// --- Owner dashboard stock health ---

export const pharmacyStockHealthQuery = createServerFn({ method: "GET" }).handler(() =>
  getPharmacyStockHealth(),
);

// --- Owner action queue ---

export const pharmacyActionQueueQuery = createServerFn({ method: "GET" }).handler(() =>
  getPharmacyActionQueue(),
);

export const refreshPharmacyActionsMutation = createServerFn({ method: "POST" }).handler(() =>
  refreshPharmacyActions(),
);

export const updatePharmacyActionMutation = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateActionSchema.parse(input))
  .handler(({ data }) => updatePharmacyAction(data));
