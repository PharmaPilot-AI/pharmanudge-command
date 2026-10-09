import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { CalendarClock, PackageX, TriangleAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { pharmacyInventoryQuery } from "@/lib/data/validation";
import type { PharmacyInventoryRow } from "@/lib/data/inventory";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
  formatInventoryDate,
  hasInventoryQuantity,
  sumInventoryValues,
} from "@/lib/inventory-format";

export const Route = createFileRoute("/inventory")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner" && role !== "accountant") {
      throw redirect({ to: "/inventory-ops" });
    }
  },
  loader: () => pharmacyInventoryQuery(),
  head: () => ({
    meta: [
      { title: "Inventory — PharmaNudge" },
      {
        name: "description",
        content: "Current pharmacy stock, purchase value and expiry risk.",
      },
    ],
  }),
  component: OwnerInventory,
});

function OwnerInventory() {
  const inventory = Route.useLoaderData();
  const { pharmacyContext } = Route.useRouteContext();
  const outOfStock = inventory.filter(
    (row) => row.is_active && !hasInventoryQuantity(row.available_quantity),
  );
  const expiring = inventory.filter((row) => hasInventoryQuantity(row.expiring_quantity));
  const expired = inventory.filter((row) => hasInventoryQuantity(row.expired_quantity));
  const stockValue = sumInventoryValues(inventory.map((row) => row.stock_value));
  const expiringValue = sumInventoryValues(inventory.map((row) => row.expiring_value));
  const asOfDate = inventory[0]?.as_of_date;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 lg:max-w-none">
      <PageHeader
        title="Inventory"
        description="Current stock, purchase value and expiry risk."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/inventory-ops">Open operations view</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Stock value"
          value={formatInventoryMoney(stockValue)}
          sub="at purchase cost, including expired stock"
          icon={Wallet}
        />
        <KpiCard
          label="Out of stock"
          value={String(outOfStock.length)}
          sub="active products with no available stock"
          icon={PackageX}
          tone={outOfStock.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Expired stock"
          value={String(expired.length)}
          sub="products with expired quantities"
          icon={TriangleAlert}
          tone={expired.length > 0 ? "danger" : "success"}
        />
        <KpiCard
          label="Value at risk"
          value={formatInventoryMoney(expiringValue)}
          sub="unexpired stock expiring within 30 days"
          icon={CalendarClock}
          tone={expiring.length > 0 ? "warning" : "success"}
        />
      </div>

      {inventory.length === 0 && (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          No products in this pharmacy yet.
        </p>
      )}

      <InventorySection
        title="Out of stock"
        empty="All active products have available stock."
        rows={outOfStock}
        detail={(row) =>
          `${row.category || "Uncategorised"} · Shelf: ${row.shelf_location || "Not assigned"}`
        }
      />
      {outOfStock.length > 0 && pharmacyContext?.role === "owner" && (
        <Button asChild variant="outline" className="self-start">
          <Link to="/receive-stock">Receive stock</Link>
        </Button>
      )}

      <InventorySection
        title="Expiry risk — next 30 days"
        empty="No remaining stock expires within the next 30 days."
        rows={expiring}
        detail={(row) =>
          `${formatInventoryQuantity(row.expiring_quantity)} ${row.base_unit_label} · Purchase value: ${formatInventoryMoney(row.expiring_value)}`
        }
      />

      <InventorySection
        title="Expired stock"
        empty="No expired stock remains."
        rows={expired}
        detail={(row) =>
          `${formatInventoryQuantity(row.expired_quantity)} ${row.base_unit_label} expired · Excluded from available stock`
        }
      />

      <p className="text-xs text-muted-foreground">
        Quantities are shown in base units. Stock expiring today is treated as expired.
        {asOfDate ? ` Expiry assessed as of ${formatInventoryDate(asOfDate)} in Lagos.` : ""}
      </p>
    </div>
  );
}

function InventorySection({
  title,
  empty,
  rows,
  detail,
}: {
  title: string;
  empty: string;
  rows: PharmacyInventoryRow[];
  detail: (row: PharmacyInventoryRow) => string;
}) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div key={row.product_id} className="rounded-xl border bg-card p-3.5">
              <p className="break-words text-sm font-semibold">
                {row.product_name}
                {!row.is_active && (
                  <span className="ml-2 text-xs text-muted-foreground">Inactive product</span>
                )}
              </p>
              <p className="text-xs tabular-nums text-muted-foreground">{detail(row)}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
