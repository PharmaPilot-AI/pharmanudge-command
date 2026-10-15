import { z } from "zod";

export const reportPeriodSchema = z.enum(["today", "week", "month"]);
export type ReportPeriod = z.infer<typeof reportPeriodSchema>;

const amount = z.string().regex(/^\d+\.\d{2}$/);
const signedAmount = z.string().regex(/^-?\d+\.\d{2}$/);
const count = z.string().regex(/^\d+$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const financialSummarySchema = z
  .object({
    period: reportPeriodSchema,
    start_date: date,
    end_date: date,
    product_revenue: amount,
    service_revenue: amount,
    total_sales: amount,
    cash_sales: amount,
    transfer_sales: amount,
    card_sales: amount,
    product_cost: amount,
    gross_profit: signedAmount,
    total_expenses: amount,
    estimated_net_profit: signedAmount,
    sale_count: count,
    expense_count: count,
  })
  .strict();

export type FinancialSummary = z.infer<typeof financialSummarySchema>;
