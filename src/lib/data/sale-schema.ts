import { z } from "zod";

const quantitySchema = z.number().finite().int().positive().max(1000000);
const priceSchema = z.number().finite().min(0).lt(1000000000000);

export const saleSchema = z
  .object({
    operation_id: z.string().uuid(),
    payment_method: z.enum(["cash", "transfer", "pos_card"]),
    lines: z
      .array(
        z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("product"),
              product_id: z.string().uuid(),
              packaging_unit_id: z.string().uuid(),
              quantity: quantitySchema,
              expected_unit_price: priceSchema,
            })
            .strict(),
          z
            .object({
              kind: z.literal("service"),
              service_id: z.string().uuid(),
              quantity: quantitySchema,
              expected_unit_price: priceSchema,
            })
            .strict(),
        ]),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type SaleInput = z.infer<typeof saleSchema>;
