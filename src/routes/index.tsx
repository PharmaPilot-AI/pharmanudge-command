import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  Banknote,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  PackageX,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi/KpiCard";
import { resolveHome } from "@/lib/auth/redirect";
import {
  pharmacyFinancialSummaryQuery,
  pharmacyDaySummaryQuery,
  pharmacyStockHealthQuery,
} from "@/lib/data/validation";
import { financialMoney, financialPercent } from "@/lib/financial-format";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role && role !== "owner") {
      throw redirect({ to: resolveHome(role) });
    }
  },
  loader: async () => {
    const [financial, day, stock] = await Promise.all([
      pharmacyFinancialSummaryQuery({ data: { period: "today" } }),
      pharmacyDaySummaryQuery(),
      pharmacyStockHealthQuery(),
    ]);

    if (financial.end_date !== day.business_date || financial.end_date !== stock.as_of_date) {
      throw new Error("The business date changed. Please refresh the dashboard.");
    }

    return { financial, day, stock };
  },
  head: () => ({
    meta: [
      { title: "PharmaNudge — Pharmacy Command Center" },
      {
        name: "description",
        content: "Today's pharmacy sales, recorded profit, reconciliation and stock health.",
      },
    ],
  }),
  component: OwnerHome,
});

function OwnerHome() {
  const { financial: f, day, stock } = Route.useLoaderData();
  const closure = day.closure;
  const hasOutOfStock = BigInt(stock.out_of_stock_products) > BigInt(0);
  const hasExpiring = BigInt(stock.expiring_batches) > BigInt(0);
  const hasExpired = BigInt(stock.expired_batches) > BigInt(0);
  const hasVariance = closure !== null && Number(closure.cash_variance) !== 0;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Your pharmacy at a glance</h1>
        <p className="mt-1 text-sm text-muted-foreground">{f.end_date} · Lagos time</p>
      </div>

      <section aria-label="Today's money" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Today's sales"
          value={financialMoney(f.total_sales)}
          sub={`${f.sale_count} transactions`}
          icon={Banknote}
          href="/money"
        />
        <KpiCard
          label="Gross profit"
          value={financialMoney(f.gross_profit)}
          sub={`${financialPercent(f.gross_profit, f.total_sales)} of sales`}
          icon={TrendingUp}
          href="/money"
        />
        <KpiCard
          label="Est. net profit"
          value={financialMoney(f.estimated_net_profit)}
          sub={`After ${financialMoney(f.total_expenses)} recorded expenses`}
          icon={CircleDollarSign}
          href="/money"
        />
        <KpiCard
          label="Cash status"
          value={closure ? financialMoney(closure.counted_cash) : "Not reconciled"}
          sub={
            closure ? `Saved variance ${financialMoney(closure.cash_variance)}` : "Today is open"
          }
          icon={Wallet}
          href="/close-day"
          tone={closure ? (hasVariance ? "danger" : "success") : "warning"}
        />
      </section>

      <section aria-label="Stock health">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Stock health
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Out of stock"
            value={stock.out_of_stock_products}
            sub={`Of ${stock.active_products} active products · no unexpired stock`}
            icon={PackageX}
            tone={hasOutOfStock ? "danger" : "success"}
            href="/inventory"
          />
          <KpiCard
            label="Low stock"
            value="Not configured"
            sub="Product reorder thresholds are not yet available"
            icon={Boxes}
            href="/inventory"
          />
          <KpiCard
            label="Expiring soon"
            value={stock.expiring_batches}
            sub="Remaining batches · next 30 days"
            icon={CalendarClock}
            tone={hasExpiring ? "warning" : "success"}
            href="/expiry"
          />
          <KpiCard
            label="Expired stock"
            value={stock.expired_batches}
            sub="Remaining batches · includes expiry today"
            icon={PackageX}
            tone={hasExpired ? "danger" : "success"}
            href="/expiry"
          />
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Needs your attention</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hasExpired && (
            <Attention
              text={`${stock.expired_batches} expired batches still have stock. Review and separate them from saleable stock.`}
              to="/expiry"
              label="Review expired stock"
            />
          )}
          {hasExpiring && (
            <Attention
              text={`${stock.expiring_batches} remaining batches expire within 30 days. Review them before deciding what action to take.`}
              to="/expiry"
              label="Review expiry"
            />
          )}
          {hasOutOfStock && (
            <Attention
              text={`${stock.out_of_stock_products} active products have no unexpired stock available. Review stock before reordering.`}
              to="/inventory"
              label="Review inventory"
            />
          )}
          <Attention
            text={
              closure
                ? hasVariance
                  ? `The saved cash reconciliation has a variance of ${financialMoney(closure.cash_variance)}. Review the closing record.`
                  : "Today's saved cash reconciliation is balanced."
                : "Today's cash drawer has not been reconciled. Review opening cash and count the drawer before closing."
            }
            to="/close-day"
            label={closure ? "View closing" : "Review reconciliation"}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Daily business brief</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Today's recorded sales are {financialMoney(f.total_sales)} across {f.sale_count}{" "}
            transactions: {financialMoney(f.product_revenue)} from products and{" "}
            {financialMoney(f.service_revenue)} from services. Recorded expenses total{" "}
            {financialMoney(f.total_expenses)}, leaving estimated net profit of{" "}
            {financialMoney(f.estimated_net_profit)} after recorded product costs and expenses.
            There are {stock.out_of_stock_products} active products without unexpired stock and{" "}
            {stock.expiring_batches} remaining batches expiring within 30 days.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Summary of recorded figures. Service delivery costs are included only where recorded as
            expenses.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link to="/money">Review financial figures</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Attention({
  text,
  to,
  label,
}: {
  text: string;
  to: "/expiry" | "/inventory" | "/close-day";
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm">{text}</p>
      <Button asChild variant="outline" size="sm" className="shrink-0">
        <Link to={to}>{label}</Link>
      </Button>
    </div>
  );
}
