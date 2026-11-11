import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { pharmacyStockBatchesQuery } from "@/lib/data/validation";
import {
  formatInventoryDate,
  formatInventoryMoney,
  formatInventoryQuantity,
  sumInventoryValues,
} from "@/lib/inventory-format";
import { describeStockLot } from "@/lib/opening-stock-display";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/expiry")({
  loader: () => pharmacyStockBatchesQuery(),
  head: () => ({
    meta: [
      { title: "Expiry Center — PharmaNudge" },
      {
        name: "description",
        content: "Stock lots, stop-sale dates and stock value at risk.",
      },
    ],
  }),
  component: ExpiryCenter,
});

function ExpiryCenter() {
  const batches = Route.useLoaderData();
  const { pharmacyContext } = Route.useRouteContext();
  const [search, setSearch] = useState("");
  const canViewValues = pharmacyContext?.role === "owner" || pharmacyContext?.role === "accountant";

  const expired = batches.filter((batch) => batch.days_to_expiry <= 0);
  const expiringSoon = batches.filter(
    (batch) => batch.days_to_expiry > 0 && batch.days_to_expiry <= 30,
  );
  const expiringLater = batches.filter(
    (batch) => batch.days_to_expiry > 30 && batch.days_to_expiry <= 90,
  );
  const atRiskValue = sumInventoryValues(
    [...expired, ...expiringSoon].map((batch) => batch.stock_value),
  );

  const query = search.trim().toLowerCase();
  const visible = batches.filter((batch) =>
    [
      batch.product_name,
      batch.opening?.manufacturer_batch ?? "",
      batch.opening?.internal_lot_reference ?? "",
      batch.opening ? "Opening stock" : batch.batch_number,
      batch.supplier_name,
    ].some((value) => value.toLowerCase().includes(query)),
  );

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Expiry Center"
        description="Remaining stock lots, sorted by stop-sale date."
      />

      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Unavailable stock lots" value={String(expired.length)} danger />
        <SummaryTile label="Stop-sale in 1–30 days" value={String(expiringSoon.length)} danger />
        <SummaryTile label="Stop-sale in 31–90 days" value={String(expiringLater.length)} />
        {canViewValues && (
          <SummaryTile
            label="Unavailable + 30-day value at cost"
            value={formatInventoryMoney(atRiskValue)}
          />
        )}
      </div>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search product, lot reference, batch or supplier"
        aria-label="Search stock lots"
      />
      <p className="text-xs text-muted-foreground">
        Showing {visible.length} of {batches.length} remaining stock lots. Summary totals cover all
        stock lots.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          {batches.length === 0
            ? "No remaining stock lots yet. Receive stock or record opening stock to add lots."
            : "No stock lots match your search."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((batch) => {
            const days = batch.days_to_expiry;
            const urgency =
              days <= 30
                ? "bg-destructive/10 text-destructive"
                : days <= 90
                  ? "bg-warning/10 text-warning"
                  : "bg-success/10 text-success";
            const lot = describeStockLot(batch);

            return (
              <div key={batch.batch_id} className="rounded-xl border bg-card p-3.5">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">{batch.product_name}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {lot.manufacturerBatch} · {lot.source}
                    </p>
                    {lot.internalLotReference && (
                      <p className="break-words text-xs text-muted-foreground">
                        Internal lot reference: {lot.internalLotReference}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", urgency)}
                  >
                    {lot.countdown}
                  </span>
                  {!batch.product_is_active && <Badge variant="outline">Inactive product</Badge>}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {batch.opening ? (
                    <>
                      <span>Physical count: {formatInventoryDate(lot.physicalCountDate)}</span>
                      <span>
                        Expiry label ({lot.expiryPrecision}): {lot.expiryLabel}
                      </span>
                      {lot.usableThrough && (
                        <span>Usable through {formatInventoryDate(lot.usableThrough)}</span>
                      )}
                      <span>Unavailable from {formatInventoryDate(lot.unavailableFrom)}</span>
                    </>
                  ) : (
                    <span>Expires {formatInventoryDate(batch.expiry_date)}</span>
                  )}
                  <span className="tabular-nums">
                    Remaining: {formatInventoryQuantity(batch.remaining_quantity)}{" "}
                    {batch.base_unit_label}
                  </span>
                  {canViewValues && (
                    <span className="tabular-nums">
                      Stock value at cost: {formatInventoryMoney(batch.stock_value)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          Quantities are shown in base units. Opening-stock stop-sale dates are exclusive:
          month-labelled lots are usable through the labelled month, then unavailable from the first
          day of the next month in Lagos. Day-labelled lots and legacy deliveries keep their
          original day cutoff; stock is unavailable on that date.
          {batches[0]
            ? ` Expiry assessed as of ${formatInventoryDate(batches[0].as_of_date)} in Lagos.`
            : ""}
        </span>
      </p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-bold tabular-nums sm:text-xl",
          danger ? "text-destructive" : "text-warning",
        )}
      >
        {value}
      </p>
    </div>
  );
}
