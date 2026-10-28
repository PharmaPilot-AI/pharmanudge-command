import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Banknote, CircleDollarSign, ReceiptText, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { pharmacyFinancialSummaryQuery, pharmacyDaySummaryQuery } from "@/lib/data/validation";
import { financialMoney, financialPercent } from "@/lib/financial-format";

export const Route = createFileRoute("/money")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner") {
      throw redirect({ to: role === "accountant" ? "/reports" : "/pos" });
    }
  },
  loader: async () => {
    const [financial, day] = await Promise.all([
      pharmacyFinancialSummaryQuery({ data: { period: "today" } }),
      pharmacyDaySummaryQuery(),
    ]);
    if (financial.end_date !== day.business_date) {
      throw new Error("The business date changed. Please refresh the page.");
    }
    return { financial, day };
  },
  head: () => ({
    meta: [
      { title: "Money — PharmaNudge" },
      {
        name: "description",
        content: "Daily pharmacy sales, recorded costs, expenses and reconciliation.",
      },
    ],
  }),
  component: MoneyPage,
});

function MoneyPage() {
  const { financial: f, day } = Route.useLoaderData();
  const closure = day.closure;

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader title="Money" description={`Today's figures · ${f.end_date} · Lagos time`} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total sales"
          value={financialMoney(f.total_sales)}
          sub={`${f.sale_count} ${Number(f.sale_count) === 1 ? "transaction" : "transactions"}`}
          icon={Banknote}
        />
        <KpiCard
          label="Gross profit"
          value={financialMoney(f.gross_profit)}
          sub={`${financialPercent(f.gross_profit, f.total_sales)} of sales`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Est. net profit"
          value={financialMoney(f.estimated_net_profit)}
          sub="after recorded expenses"
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Expenses today"
          value={financialMoney(f.total_expenses)}
          sub={`${f.expense_count} entries`}
          icon={ReceiptText}
          href="/expenses"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Revenue and recorded costs</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Product revenue" value={financialMoney(f.product_revenue)} />
            <Row label="Service revenue" value={financialMoney(f.service_revenue)} />
            <Row
              label="Service share of revenue"
              value={financialPercent(f.service_revenue, f.total_sales)}
            />
            <Row label="Cost of products sold" value={financialMoney(f.product_cost)} />
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">
            Estimated net profit deducts recorded product costs and expenses. Service delivery costs
            are included only where recorded as expenses.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Payments received</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Cash sales" value={financialMoney(f.cash_sales)} />
            <Row label="Bank transfer sales" value={financialMoney(f.transfer_sales)} />
            <Row label="Card sales" value={financialMoney(f.card_sales)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Cash reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          {closure ? (
            <>
              <p className="mb-3 text-sm font-semibold">Day closed · saved reconciliation</p>
              <dl className="flex flex-col gap-2 text-sm">
                <Row label="Opening cash" value={financialMoney(closure.opening_cash)} />
                <Row label="Expected cash" value={financialMoney(closure.expected_cash)} />
                <Row label="Counted cash" value={financialMoney(closure.counted_cash)} />
                <Row label="Variance" value={financialMoney(closure.cash_variance)} />
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Today is open. Opening cash and counted cash have not been saved. Review the drawer in
              Close Day to establish the expected cash and variance.
            </p>
          )}
          <Button asChild className="mt-4" size="sm">
            <Link to="/close-day">{closure ? "View saved closing" : "Review & close day"}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
