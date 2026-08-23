import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, CalendarClock, PackageX, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionCard } from "@/components/actions/ActionCard";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  expiringBatches,
  expiryValueAtRisk,
  initialActions,
  lowStockProducts,
  outOfStockProducts,
  productById,
  products,
} from "@/lib/mock-data";
import { baseStockLabel, expiryTone, formatNaira } from "@/lib/money";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory Intelligence — PharmaPilot AI" },
      { name: "description", content: "What stock am I losing or about to run out of? Low stock, out of stock, expiry risk and value at risk." },
      { property: "og:title", content: "Inventory Intelligence — PharmaPilot AI" },
      { property: "og:description", content: "Low stock, out of stock, expiry risk and value at risk." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: OwnerInventory,
});

/**
 * Owner-facing inventory intelligence: answers "what stock am I losing or
 * about to run out of?" — operational management lives in /inventory-ops.
 */
function OwnerInventory() {
  const stockValue = products.reduce((sum, p) => sum + p.baseUnitsInStock * p.costPerBaseUnit, 0);
  const priorityActions = initialActions.filter((a) => a.severity !== "info").slice(0, 3);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 lg:max-w-none">
      <PageHeader
        title="Inventory"
        description="What stock am I losing or about to run out of?"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/inventory-ops">Open operations view</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Stock value" value={formatNaira(stockValue)} sub="at cost price" icon={Wallet} />
        <KpiCard
          label="Out of stock"
          value={String(outOfStockProducts.length)}
          sub="items"
          icon={PackageX}
          tone={outOfStockProducts.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Low stock"
          value={String(lowStockProducts.length)}
          sub="below reorder level"
          icon={TriangleAlert}
          tone={lowStockProducts.length > 0 ? "warning" : "success"}
        />
        <KpiCard
          label="Value at risk"
          value={formatNaira(expiryValueAtRisk)}
          sub="expiring ≤ 30 days"
          icon={CalendarClock}
          tone={expiryValueAtRisk > 0 ? "warning" : "success"}
          href="/expiry"
        />
      </div>

      {/* Out of stock */}
      <InventorySection
        title="Out of stock"
        tone="danger"
        empty="Nothing is out of stock right now."
        items={outOfStockProducts.map((p) => ({
          id: p.id,
          title: p.name,
          detail: `${p.category} · ${p.shelfLocation}`,
          trailing: (
            <Button asChild size="sm" variant="outline">
              <Link to="/receive-stock">Receive stock</Link>
            </Button>
          ),
        }))}
      />

      {/* Low stock */}
      <InventorySection
        title="Low stock"
        tone="warning"
        empty="No items below their reorder level."
        items={lowStockProducts.map((p) => ({
          id: p.id,
          title: p.name,
          detail: `${baseStockLabel(p)} left · reorder at ${p.reorderLevelBaseUnits.toLocaleString("en-US")}`,
          trailing: (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning">
              Reorder
            </span>
          ),
        }))}
      />

      {/* Expiry risk */}
      <InventorySection
        title="Expiry risk — next 30 days"
        tone="warning"
        empty="No batches expiring within 30 days."
        items={expiringBatches.map((b) => {
          const product = productById(b.productId);
          const tone = expiryTone(b.daysToExpiry);
          return {
            id: b.id,
            title: `${product?.name ?? b.productId} · Batch ${b.batchNumber}`,
            detail: `${b.baseUnitsRemaining.toLocaleString("en-US")} ${product?.baseUnitLabel ?? "unit"}s · value ${formatNaira(b.baseUnitsRemaining * b.costPerBaseUnit)}`,
            trailing: (
              <span
                className={
                  tone === "critical"
                    ? "rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive"
                    : "rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-semibold text-warning"
                }
              >
                {b.daysToExpiry} days
              </span>
            ),
          };
        })}
        footerLink={
          <Link to="/expiry" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Open Expiry Center <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />

      {/* Prioritized actions */}
      <section aria-label="Prioritized inventory actions">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Boxes className="h-4 w-4" aria-hidden />
          Prioritized actions
        </h2>
        <div className="flex flex-col gap-2.5">
          {priorityActions.map((action) => (
            <ActionCard key={action.id} action={action} />
          ))}
        </div>
      </section>
    </div>
  );
}

interface SectionItem {
  id: string;
  title: string;
  detail: string;
  trailing?: React.ReactNode;
}

function InventorySection({
  title,
  items,
  empty,
  footerLink,
}: {
  title: string;
  tone: "danger" | "warning";
  items: SectionItem[];
  empty: string;
  footerLink?: React.ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{item.title}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{item.detail}</p>
              </div>
              {item.trailing}
            </div>
          ))}
          {footerLink}
        </div>
      )}
    </section>
  );
}
