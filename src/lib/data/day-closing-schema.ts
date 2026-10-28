import { z } from "zod";

const moneyText = z.string().regex(/^\d+\.\d{2}$/);
const signedMoneyText = z.string().regex(/^-?\d+\.\d{2}$/);
const countText = z.string().regex(/^\d+$/);

const businessDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value &&
      value >= "2000-01-01" &&
      value <= "2100-12-31"
    );
  }, "Enter a valid business date.");

const cashAmount = z
  .number()
  .finite()
  .min(0)
  .lt(1000000000000)
  .refine(
    (value) => /^\d+(\.\d{1,2})?$/.test(String(value)),
    "Enter a cash amount with at most two decimal places.",
  );

export const dayTotalsSchema = z
  .object({
    cash_sales: moneyText,
    transfer_sales: moneyText,
    card_sales: moneyText,
    cash_expenses: moneyText,
    transfer_expenses: moneyText,
    card_expenses: moneyText,
    sale_count: countText,
    expense_count: countText,
  })
  .strict();

export const closeDaySchema = z
  .object({
    operation_id: z.string().uuid(),
    business_date: businessDate,
    opening_cash: cashAmount,
    counted_cash: cashAmount,
    notes: z.string().trim().max(1000),
    reviewed_totals: dayTotalsSchema,
  })
  .strict();

export const savedDayClosureSchema = dayTotalsSchema
  .extend({
    id: z.string().uuid(),
    business_date: businessDate,
    closed_by: z.string().uuid(),
    closed_by_email: z.string().nullable().optional(),
    closed_at: z.string().datetime({ offset: true }),
    opening_cash: moneyText,
    counted_cash: moneyText,
    expected_cash: signedMoneyText,
    cash_variance: signedMoneyText,
    notes: z.string().max(1000),
  })
  .strict();

export const daySummarySchema = z
  .object({
    business_date: businessDate,
    totals: dayTotalsSchema,
    closure: savedDayClosureSchema.nullable(),
  })
  .strict();

export type CloseDayInput = z.infer<typeof closeDaySchema>;
export type DaySummary = z.infer<typeof daySummarySchema>;
export type DayTotals = z.infer<typeof dayTotalsSchema>;
