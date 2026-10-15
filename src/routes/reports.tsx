import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pharmacyFinancialSummaryQuery } from "@/lib/data/validation";
import { reportPeriodSchema } from "@/lib/data/financial-schema";
import { financialMoney, financialPercent } from "@/lib/financial-format";

export const Route = createFileRoute("/reports")({
  validateSearch: (search: Record<string, unknown>) => ({
    period: reportPeriodSchema.catch("today").parse(search["period"]),
  }),
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner" && role !== "accountant") {
      throw redirect({ to: "/pos" });
    }
  },
  loaderDeps: ({ search }) => ({ period: search.period }),
  loader: ({ deps }) => pharmacyFinancialSummaryQuery({ data: { period: deps.period } }),
  head: () => ({
    meta: [
      { title: "Reports — PharmaNudge" },
      {
        name: "description",
        content: "Pharmacy sales, recorded costs and expenses by reporting period.",
      },
    ],
  }),
  component: ReportsPage,
});

const periods = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
] as const;

function ReportsPage() {
  const f = Route.useLoaderData();

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Reports"
        description={`${f.start_date} to ${f.end_date} · Lagos time · weeks start Monday`}
      />

      <nav aria-label="Report period" className="flex flex-wrap gap-2">
        {periods.map((period) => (
          <Button
            key={period.value}
            asChild
            variant={f.period === period.value ? "default" : "outline"}
            size="sm"
          >
            <Link
              to="/reports"
              search={{ period: period.value }}
              aria-current={f.period === period.value ? "page" : undefined}
            >
              {period.label}
            </Link>
          </Button>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sales</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Total sales" value={financialMoney(f.total_sales)} />
              <Row label="Transactions" value={f.sale_count} />
              <Row label="Product revenue" value={financialMoney(f.product_revenue)} />
              <Row label="Service revenue" value={financialMoney(f.service_revenue)} />
              <Row
                label="Service share"
                value={financialPercent(f.service_revenue, f.total_sales)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Profit and expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Cost of products sold" value={financialMoney(f.product_cost)} />
              <Row label="Gross profit" value={financialMoney(f.gross_profit)} />
              <Row label="Gross margin" value={financialPercent(f.gross_profit, f.total_sales)} />
              <Row label="Recorded expenses" value={financialMoney(f.total_expenses)} />
              <Row label="Expense entries" value={f.expense_count} />
              <Row label="Est. net profit" value={financialMoney(f.estimated_net_profit)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sales by payment method</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Cash" value={financialMoney(f.cash_sales)} />
              <Row label="Bank transfer" value={financialMoney(f.transfer_sales)} />
              <Row label="Card" value={financialMoney(f.card_sales)} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current stock and expiry</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              View current stock valuation and remaining batches on the live inventory and expiry
              pages. These are current balances, independent of the selected financial reporting
              period.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/inventory">Inventory valuation</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link to="/expiry">Expiry batches</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Estimated net profit deducts recorded product costs and expenses. Service delivery costs are
        included only where recorded as expenses. A dash means the percentage is undefined because
        total sales are zero.
      </p>
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
