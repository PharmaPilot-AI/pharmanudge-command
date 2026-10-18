const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTs } = require("./helpers/load-ts.cjs");

const scope = { userId: "fixture-user", pharmacyId: "pharmacy-a", role: "owner" };
const moved = { ...scope, pharmacyId: "pharmacy-b" };
const financial = {
  period: "week",
  start_date: "2026-10-12",
  end_date: "2026-10-18",
  product_revenue: "0.00",
  service_revenue: "0.00",
  total_sales: "0.00",
  cash_sales: "0.00",
  transfer_sales: "0.00",
  card_sales: "0.00",
  product_cost: "0.00",
  gross_profit: "0.00",
  total_expenses: "0.00",
  estimated_net_profit: "0.00",
  sale_count: "0",
  expense_count: "0",
};
const stock = {
  as_of_date: "2026-10-18",
  active_products: "1",
  out_of_stock_products: "0",
  expiring_batches: "0",
  expired_batches: "0",
  low_stock_products: null,
};
function deps(context, result, calls) {
  return {
    "../auth/context": {
      resolveSessionUser: async () => ({ userId: scope.userId, accessToken: "fixture-token" }),
    },
    "../supabase/server": {
      createServerSupabaseClient: () => ({
        rpc: async (_name, args) => {
          calls.push(args.target_pharmacy_id);
          return { data: result, error: null };
        },
      }),
    },
    "../pharmacy-context": { requirePharmacyContext: async () => context },
  };
}
for (const drift of ["financial", "stock"]) {
  test(`captured owner scope is bound inside the actual ${drift} DAL, even if membership returns to A`, async () => {
    const calls = [];
    const money = loadTs(
      "src/lib/data/financial.ts",
      deps(drift === "financial" ? moved : scope, financial, calls),
    );
    const health = loadTs(
      "src/lib/data/stock-health.ts",
      deps(drift === "stock" ? moved : scope, stock, calls),
    );
    const context = loadTs("src/lib/data/ask-ai-context.ts", {
      ...deps(scope, null, calls),
      "./financial": money,
      "./stock-health": health,
      "./day-closing": {
        getPharmacyDaySummary: async () => ({
          ...scope,
          business_date: "2026-10-18",
          closure: null,
        }),
      },
    });
    await assert.rejects(context.getAskAiContext("week", scope));
    assert.equal(calls.includes("pharmacy-b"), false);
  });
}
