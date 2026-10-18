import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext, type PharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { financialMoney } from "../financial-format";
import { getPharmacyFinancialSummary } from "./financial";
import { getPharmacyDaySummary } from "./day-closing";
import { getPharmacyStockHealth } from "./stock-health";
import { reportPeriodSchema, type ReportPeriod } from "./financial-schema";
import { aiFactSchema, type AiFact } from "./ask-ai-schema";

export async function getAskAiContext(period: ReportPeriod, expectedContext?: PharmacyContext) {
  const selectedPeriod = reportPeriodSchema.parse(period);
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to ask PharmaNudge.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (
    context.role !== "owner" ||
    context.userId !== session.userId ||
    (expectedContext &&
      (context.userId !== expectedContext.userId ||
        context.pharmacyId !== expectedContext.pharmacyId))
  ) {
    throw new Error("Only an active owner can use Ask PharmaNudge.");
  }

  const [financial, day, stock] = await Promise.all([
    getPharmacyFinancialSummary(selectedPeriod, context),
    getPharmacyDaySummary(),
    getPharmacyStockHealth(context),
  ]);

  // These existing services reauthorize each read independently. Fail closed
  // if membership drifted while they ran, and never forward identity fields
  // or the saved closure's free-text notes to the model.
  const current = await requirePharmacyContext(client);
  if (
    current.role !== "owner" ||
    current.userId !== context.userId ||
    current.pharmacyId !== context.pharmacyId ||
    day.role !== "owner" ||
    day.userId !== context.userId ||
    day.pharmacyId !== context.pharmacyId
  ) {
    throw new Error("Owner pharmacy access changed. Please refresh and try again.");
  }

  if (
    financial.end_date !== day.business_date ||
    financial.end_date !== stock.as_of_date ||
    (day.closure && day.closure.business_date !== day.business_date)
  ) {
    throw new Error("The business date changed. Please ask again.");
  }

  const facts: AiFact[] = [];
  function add(id: string, text: string, sourceLabel: string, sourcePath: AiFact["source_path"]) {
    facts.push(
      aiFactSchema.parse({
        id,
        text,
        source_label: sourceLabel,
        source_path: sourcePath,
      }),
    );
  }

  const dates = `${financial.start_date} to ${financial.end_date}, Lagos time`;
  const reportSource = `Reports: ${dates}`;

  add("report_period", `Selected financial period: ${dates}.`, reportSource, "/reports");
  add(
    "sales",
    `Recorded sales: ${financialMoney(financial.total_sales)} across ${financial.sale_count} transactions.`,
    reportSource,
    "/reports",
  );
  add(
    "revenue_split",
    `Product revenue: ${financialMoney(financial.product_revenue)}. Service revenue: ${financialMoney(financial.service_revenue)}.`,
    reportSource,
    "/reports",
  );
  add(
    "sales_payments",
    `Sales payments: cash ${financialMoney(financial.cash_sales)}, transfer ${financialMoney(financial.transfer_sales)}, POS card ${financialMoney(financial.card_sales)}.`,
    reportSource,
    "/reports",
  );
  add(
    "product_cost",
    `Recorded cost of products sold: ${financialMoney(financial.product_cost)}, calculated from batch-level sale deductions.`,
    reportSource,
    "/reports",
  );
  add(
    "gross_profit",
    `Recorded gross profit: ${financialMoney(financial.gross_profit)}; sales less recorded product costs.`,
    reportSource,
    "/reports",
  );
  add(
    "expenses",
    `Recorded expenses: ${financialMoney(financial.total_expenses)} across ${financial.expense_count} entries.`,
    reportSource,
    "/reports",
  );
  add(
    "net_profit",
    `Estimated net profit after recorded product costs and expenses: ${financialMoney(financial.estimated_net_profit)}.`,
    reportSource,
    "/reports",
  );

  const stockSource = `Current inventory: ${stock.as_of_date}`;
  add(
    "stock_availability",
    `As of ${stock.as_of_date}, ${stock.out_of_stock_products} of ${stock.active_products} active products have no unexpired stock available.`,
    stockSource,
    "/inventory",
  );
  add(
    "expiry",
    `As of ${stock.as_of_date}, ${stock.expiring_batches} remaining stock batches expire within the next 30 days; ${stock.expired_batches} remaining batches are expired, including expiry today.`,
    `Expiry Center: ${stock.as_of_date}`,
    "/expiry",
  );

  const closure = day.closure;
  if (closure) {
    add(
      "cash_reconciliation",
      `Saved reconciliation for ${day.business_date}: opening cash ${financialMoney(closure.opening_cash)}, expected cash ${financialMoney(closure.expected_cash)}, counted cash ${financialMoney(closure.counted_cash)}, variance ${financialMoney(closure.cash_variance)}.`,
      `Close Day: ${day.business_date}`,
      "/close-day",
    );
  } else {
    add(
      "cash_reconciliation",
      `There is no saved cash reconciliation for ${day.business_date}. Counted cash and cash variance have not been established by a saved closing.`,
      `Close Day: ${day.business_date}`,
      "/close-day",
    );
  }

  return {
    period: selectedPeriod,
    businessDate: day.business_date,
    retrievedAt: new Date().toISOString(),
    facts,
    limitations: [
      "Financial figures cover only the selected period and recorded transactions.",
      "Stock figures describe current balances, not historical balances for the financial period.",
      "Reconciliation describes the current Lagos business day only.",
      "Service delivery costs affect estimated profit only where recorded as expenses.",
      "Low-stock thresholds are not configured.",
      "This evidence does not include product-level sales rankings, staff performance, customer demand, prior-period comparisons or historical closing records.",
      "The queries are separate reads; transactions recorded during retrieval may appear at slightly different times.",
      "No stock, financial records or workflow states were changed.",
    ],
  };
}
