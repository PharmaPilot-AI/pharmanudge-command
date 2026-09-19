import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Banknote, CircleDollarSign, ReceiptText, Stethoscope, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi/KpiCard";
import { ReconciliationBadge } from "@/components/kpi/ReconciliationBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { initialExpenses, todayKpis } from "@/lib/mock-data";
import { formatNaira } from "@/lib/money";

export const Route = createFileRoute("/money")({
  head: () => ({
    meta: [
      { title: "Money — PharmaNudge" },
      { name: "description", content: "How much did I sell, how much did I make, and is my money complete? Revenue, profit and cash reconciliation." },
      { property: "og:title", content: "Money — PharmaNudge" },
      { property: "og:description", content: "Revenue, profit and cash reconciliation for your pharmacy." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: MoneyPage,
});

/** Owner money view: "How much did I sell / make — and is my money complete?" */
function MoneyPage() {
  const variance = todayKpis.countedCash - todayKpis.expectedCash;
  const productShare = Math.round(
    (todayKpis.productRevenue / todayKpis.salesTotal) * 100,
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 lg:max-w-none">
      <PageHeader title="Money" description="Sales, profit and whether today's money is complete." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Total sales"
          value={formatNaira(todayKpis.salesTotal)}
          deltaPct={todayKpis.salesDeltaPct}
          icon={Banknote}
          tone="success"
        />
        <KpiCard
          label="Gross margin"
          value={formatNaira(todayKpis.grossMargin)}
          sub={`${todayKpis.grossMarginPct}% of sales`}
          icon={TrendingUp}
        />
        <KpiCard
          label="Est. net profit"
          value={formatNaira(todayKpis.estimatedNetProfit)}
          sub="after expenses"
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Expenses today"
          value={formatNaira(todayKpis.expensesTotal)}
          sub={`${initialExpenses.length} entries`}
          icon={ReceiptText}
          href="/expenses"
        />
      </div>

      {/* Revenue split — product vs service revenue is always distinguishable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Where today's revenue came from</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-3.5 w-full overflow-hidden rounded-full" role="img" aria-label={`Product revenue ${productShare} percent, service revenue ${100 - productShare} percent`}>
            <div className="bg-primary" style={{ width: `${productShare}%` }} />
            <div className="bg-info" style={{ width: `${100 - productShare}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
              <div>
                <p className="text-sm font-semibold tabular-nums">{formatNaira(todayKpis.productRevenue)}</p>
                <p className="text-xs text-muted-foreground">Product sales · {productShare}%</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-info" aria-hidden />
              <div>
                <p className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                  {formatNaira(todayKpis.serviceRevenue)}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Stethoscope className="h-3 w-3" aria-hidden />
                  Services · {100 - productShare}% · no stock impact
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cash reconciliation */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Wallet className="h-4 w-4 text-primary" aria-hidden />
              Cash reconciliation
            </CardTitle>
            <ReconciliationBadge variance={variance} />
          </div>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Expected cash</dt>
              <dd className="font-medium tabular-nums">{formatNaira(todayKpis.expectedCash)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Counted cash</dt>
              <dd className="font-medium tabular-nums">{formatNaira(todayKpis.countedCash)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2">
              <dt className="font-medium">Variance</dt>
              <dd className="font-bold tabular-nums text-destructive">{formatNaira(variance)}</dd>
            </div>
          </dl>
          <Button asChild className="mt-3 w-full sm:w-auto" size="sm">
            <Link to="/close-day">
              Review & close day
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
