import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Banknote,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  PackageX,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/actions/ActionCard";
import { KpiCard } from "@/components/kpi/KpiCard";
import { ReconciliationBadge } from "@/components/kpi/ReconciliationBadge";
import { useAppMode } from "@/lib/app-mode";
import {
  expiringBatches,
  initialActions,
  lowStockProducts,
  outOfStockProducts,
  todayKpis,
  dailyBrief,
} from "@/lib/mock-data";
import { formatNaira } from "@/lib/money";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PharmaNudge — Pharmacy Command Center" },
      {
        name: "description",
        content:
          "See today's sales, profit, cash status and stock risks at a glance. PharmaNudge is the decision-intelligence platform for Nigerian pharmacies.",
      },
      { property: "og:title", content: "PharmaNudge — Pharmacy Command Center" },
      {
        property: "og:description",
        content: "Sales, profit, cash and stock health for your pharmacy — understood in 60 seconds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OwnerHome,
});

/**
 * Owner Home / Command Center. Designed so the owner understands the health
 * of the pharmacy in ~60 seconds — KPIs and actions lead, not charts.
 */
function OwnerHome() {
  const { member } = useAppMode();
  const firstName = member.name.split(" ")[0];
  const cashVariance = todayKpis.countedCash - todayKpis.expectedCash;
  const topActions = initialActions.slice(0, 3);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 lg:max-w-none">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          Good morning, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Sunday, 23 August 2026 · Here is your pharmacy at a glance.
        </p>
      </div>

      {/* Money KPIs */}
      <section aria-label="Today's money">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Today's Sales"
            value={formatNaira(todayKpis.salesTotal)}
            deltaPct={todayKpis.salesDeltaPct}
            icon={Banknote}
            tone="success"
            href="/money"
          />
          <KpiCard
            label="Gross Margin"
            value={formatNaira(todayKpis.grossMargin)}
            sub={`${todayKpis.grossMarginPct}% of sales`}
            icon={TrendingUp}
            href="/money"
          />
          <KpiCard
            label="Est. Net Profit"
            value={formatNaira(todayKpis.estimatedNetProfit)}
            sub={`After ${formatNaira(todayKpis.expensesTotal)} expenses`}
            icon={CircleDollarSign}
            href="/money"
          />
          <KpiCard
            label="Cash Status"
            value={formatNaira(todayKpis.countedCash)}
            sub={`Expected ${formatNaira(todayKpis.expectedCash)}`}
            icon={Wallet}
            tone={cashVariance === 0 ? "success" : "danger"}
            href="/close-day"
            footer={<ReconciliationBadge variance={cashVariance} />}
          />
        </div>
      </section>

      {/* Stock health */}
      <section aria-label="Stock health">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Stock health
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard
            label="Out of stock"
            value={String(outOfStockProducts.length)}
            sub="items"
            icon={PackageX}
            tone={outOfStockProducts.length > 0 ? "danger" : "success"}
            href="/inventory"
          />
          <KpiCard
            label="Low stock"
            value={String(lowStockProducts.length)}
            sub="items"
            icon={Boxes}
            tone={lowStockProducts.length > 0 ? "warning" : "success"}
            href="/inventory"
          />
          <KpiCard
            label="Expiry risk"
            value={String(expiringBatches.length)}
            sub="batches ≤ 30 days"
            icon={CalendarClock}
            tone={expiringBatches.length > 0 ? "warning" : "success"}
            href="/expiry"
          />
        </div>
      </section>

      {/* Top actions */}
      <section aria-label="Actions requiring attention">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs your attention
          </h2>
          <Link
            to="/actions"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        <div className="flex flex-col gap-2.5">
          {topActions.map((action) => (
            <ActionCard key={action.id} action={action} />
          ))}
        </div>
      </section>

      {/* Daily brief */}
      <section aria-label="Daily business brief">
        <div className="rounded-xl border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            Daily Business Brief
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{dailyBrief}</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/ask-ai">Ask PharmaNudge about today</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
