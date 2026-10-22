import { z } from "zod";

const expiryDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "A valid expiry date is required.");

export const stockReceiptSchema = z
  .object({
    operation_id: z.string().uuid(),
    supplier_name: z.string().trim().min(1).max(200),
    invoice_reference: z.string().trim().max(100),
    items: z
      .array(
        z
          .object({
            product_id: z.string().uuid(),
            packaging_unit_id: z.string().uuid(),
            quantity: z.number().finite().positive().lt(1000000000000),
            cost_per_packaging_unit: z.number().finite().min(0).lt(1000000000000),
            batch_number: z.string().trim().min(1).max(100),
            expiry_date: expiryDateSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;

/** Identity pins are compared to server-resolved context, never used as authority. */
export const receiptSubmissionSchema = z
  .object({
    version: z.literal(1),
    pharmacyId: z.string().uuid(),
    userId: z.string().uuid(),
    request: stockReceiptSchema,
  })
  .strict();

export type ReceiptSubmission = z.infer<typeof receiptSubmissionSchema>;
export type ReceiptDraft = Omit<StockReceiptInput, "operation_id">;
