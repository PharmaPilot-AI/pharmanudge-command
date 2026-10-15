import { z } from "zod";

export const EXPENSE_CATEGORIES = [
  "Utilities",
  "Supplies",
  "Logistics",
  "Bank & POS charges",
  "Salaries & wages",
  "Rent",
  "Other",
] as const;

export const EXPENSE_PAYMENT_SOURCES = ["cash", "transfer", "pos_card"] as const;

// Keep input within a range where integer kobo remains safely representable.
const expenseAmountSchema = z
  .number()
  .finite()
  .positive()
  .lt(1000000000000)
  .refine(
    (value) => /^\d+(\.\d{1,2})?$/.test(String(value)),
    "Enter an amount with at most two decimal places.",
  );

export const expenseSchema = z
  .object({
    operation_id: z.string().uuid(),
    category: z.enum(EXPENSE_CATEGORIES),
    description: z.string().trim().min(1).max(500),
    amount: expenseAmountSchema,
    payment_source: z.enum(EXPENSE_PAYMENT_SOURCES),
  })
  .strict();

export type ExpenseInput = z.infer<typeof expenseSchema>;
