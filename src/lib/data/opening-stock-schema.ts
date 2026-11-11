import { z } from "zod";
import { expiryCutoff, isValidPhysicalCountDate } from "../opening-stock";

// numeric(18,6): explicit finite positive values only, without silently rounding input.
const stockNumber = z
  .number()
  .finite()
  .positive()
  .lt(1_000_000_000_000)
  .refine((value) => Number(value.toFixed(6)) === value, "Use at most six decimal places.");

export const openingStockItemSchema = z
  .object({
    product_id: z.string().uuid(),
    packaging_unit_id: z.string().uuid(),
    quantity: stockNumber,
    cost_per_packaging_unit: stockNumber,
    batch_unknown: z.boolean(),
    manufacturer_batch: z.string().trim().min(1).max(100).nullable(),
    internal_lot_reference: z.string().trim().min(1).max(50),
    expiry_precision: z.enum(["month", "day"]),
    expiry_label: z.string().trim().min(1).max(10),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.batch_unknown !== (item.manufacturer_batch === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["manufacturer_batch"],
        message: "Record the real manufacturer batch, or mark it unknown and leave it null.",
      });
    }
    try {
      expiryCutoff(item.expiry_precision, item.expiry_label);
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiry_label"],
        message: "A valid known month or day expiry is required.",
      });
    }
    // The rounded line valuation must fit numeric(18,2). Use decimal integers, not floating arithmetic.
    if (
      stockNumber.safeParse(item.quantity).success &&
      stockNumber.safeParse(item.cost_per_packaging_unit).success
    ) {
      const micros = (value: number) => BigInt(value.toFixed(6).replace(".", ""));
      const roundedCents =
        (micros(item.quantity) * micros(item.cost_per_packaging_unit) + 5_000_000_000n) /
        10_000_000_000n;
      if (roundedCents >= 1_000_000_000_000_000_000n) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["cost_per_packaging_unit"],
          message: "Opening stock valuation exceeds the database limit.",
        });
      }
    }
  });

export const physicalCountDateSchema = z
  .string()
  .refine(
    (value) => isValidPhysicalCountDate(value),
    "A valid physical count date no later than today (Lagos) is required.",
  );

export const openingStockSchema = z
  .object({
    operation_id: z.string().uuid(),
    physical_count_date: physicalCountDateSchema,
    items: z
      .array(openingStockItemSchema)
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.internal_lot_reference)).size === items.length,
        "Each opening lot must have a unique internal reference.",
      ),
  })
  .strict();

/** Client pins are compared to authenticated server context, never trusted as authority. */
export const openingStockSubmissionSchema = z
  .object({
    version: z.literal(1),
    pharmacyId: z.string().uuid(),
    userId: z.string().uuid(),
    request: openingStockSchema,
  })
  .strict();

export type OpeningStockItem = z.infer<typeof openingStockItemSchema>;
export type OpeningStockRequest = z.infer<typeof openingStockSchema>;
export type OpeningStockSubmission = z.infer<typeof openingStockSubmissionSchema>;
export type OpeningStockDraft = Omit<OpeningStockRequest, "operation_id">;
