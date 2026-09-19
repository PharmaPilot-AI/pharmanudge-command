import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ClipboardList, PencilLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { batches, products } from "@/lib/mock-data";
import {
  baseStockLabel,
  formatNaira,
  formatNairaSigned,
  productStockStatus,
  stockStatusLabel,
} from "@/lib/money";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventory-ops")({
  head: () => ({
    meta: [
      { title: "Inventory Operations — PharmaNudge" },
      { name: "description", content: "Detailed stock table with batches, shelf locations, counts and adjustments." },
      { property: "og:title", content: "Inventory Operations — PharmaNudge" },
      { property: "og:description", content: "Detailed stock table with batches, shelf locations, counts and adjustments." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: InventoryOps,
});

const adjustmentReasons = ["Cycle count correction", "Damaged stock", "Theft / loss", "Supplier return"];

const statusBadgeClasses: Record<string, string> = {
  out: "bg-destructive/10 text-destructive",
  low: "bg-warning/10 text-warning",
  ok: "bg-success/10 text-success",
};

/**
 * Operational inventory: detailed table, batches, shelf locations and local
 * stock adjustments. Adjustments will become immutable ledger events in
 * Phase 2 — here they only update local mock state.
 */
function InventoryOps() {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      products.map((p) => ({
        product: p,
        effectiveStock: p.baseUnitsInStock + (overrides[p.id] ?? 0),
        productBatches: batches.filter((b) => b.productId === p.id),
      })),
    [overrides],
  );

  const reorderCount = rows.filter(
    (r) => r.effectiveStock <= r.product.reorderLevelBaseUnits,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Inventory"
        description="Stock counts, batches, shelf locations and adjustments."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.success(`Reorder list drafted for ${reorderCount} item${reorderCount === 1 ? "" : "s"} (Phase 1 mock)`)
            }
          >
            <ClipboardList className="h-4 w-4" aria-hidden />
            Draft reorder list ({reorderCount})
          </Button>
        }
      />

      {/* Desktop table */}
      <div className="hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Shelf</TableHead>
              <TableHead className="text-right">Stock (base units)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Batches · nearest expiry</TableHead>
              <TableHead className="text-right">Stock value</TableHead>
              <TableHead className="text-right">Adjust</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <InventoryRow
                key={row.product.id}
                row={row}
                delta={overrides[row.product.id] ?? 0}
                adjusting={adjustingId === row.product.id}
                onToggleAdjust={() =>
                  setAdjustingId((prev) => (prev === row.product.id ? null : row.product.id))
                }
                onApply={(delta, reason) => {
                  setOverrides((prev) => ({
                    ...prev,
                    [row.product.id]: (prev[row.product.id] ?? 0) + delta,
                  }));
                  setAdjustingId(null);
                  toast.success(
                    `Adjustment recorded locally: ${formatNairaSigned(delta * row.product.costPerBaseUnit)} · ${reason}`,
                  );
                }}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => {
          const status = productStockStatus({
            ...row.product,
            baseUnitsInStock: row.effectiveStock,
          });
          const nearest = nearestExpiryDays(row.product.id);
          return (
            <div key={row.product.id} className="rounded-xl border bg-card p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{row.product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.product.shelfLocation} · {row.productBatches.length} batch
                    {row.productBatches.length === 1 ? "" : "es"}
                    {nearest !== null ? ` · nearest expiry ${nearest}d` : ""}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClasses[status])}>
                  {stockStatusLabel(status)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-sm">
                <span className="tabular-nums text-muted-foreground">
                  {row.effectiveStock.toLocaleString("en-US")} {row.product.baseUnitLabel}s
                  {(overrides[row.product.id] ?? 0) !== 0 && (
                    <span className="ml-1 font-medium text-info">
                      ({formatNairaSigned((overrides[row.product.id] ?? 0) * row.product.costPerBaseUnit)} adj.)
                    </span>
                  )}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() =>
                    setAdjustingId((prev) => (prev === row.product.id ? null : row.product.id))
                  }
                >
                  <PencilLine className="h-3.5 w-3.5" aria-hidden />
                  Adjust
                </Button>
              </div>
              {adjustingId === row.product.id && (
                <AdjustPanel
                  product={row.product}
                  onApply={(delta, reason) => {
                    setOverrides((prev) => ({
                      ...prev,
                      [row.product.id]: (prev[row.product.id] ?? 0) + delta,
                    }));
                    setAdjustingId(null);
                    toast.success("Adjustment recorded locally (Phase 1 mock)");
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Stock is tracked in base units. In Phase 2 every adjustment becomes an immutable ledger
        event with a reason and an author — nothing is silently overwritten.
      </p>
    </div>
  );
}

function nearestExpiryDays(productId: string): number | null {
  const list = batches.filter((b) => b.productId === productId);
  if (list.length === 0) return null;
  return Math.min(...list.map((b) => b.daysToExpiry));
}

interface RowData {
  product: Product;
  effectiveStock: number;
  productBatches: typeof batches;
}

function InventoryRow({
  row,
  delta,
  adjusting,
  onToggleAdjust,
  onApply,
}: {
  row: RowData;
  delta: number;
  adjusting: boolean;
  onToggleAdjust: () => void;
  onApply: (delta: number, reason: string) => void;
}) {
  const status = productStockStatus({ ...row.product, baseUnitsInStock: row.effectiveStock });
  const nearest = nearestExpiryDays(row.product.id);

  return (
    <>
      <TableRow>
        <TableCell>
          <p className="font-medium">{row.product.name}</p>
          <p className="text-xs text-muted-foreground">{row.product.genericName}</p>
        </TableCell>
        <TableCell className="text-muted-foreground">{row.product.shelfLocation}</TableCell>
        <TableCell className="text-right tabular-nums">
          {row.effectiveStock.toLocaleString("en-US")} {row.product.baseUnitLabel}s
          {delta !== 0 && (
            <span className="block text-xs font-medium text-info">{formatNairaSigned(delta)} units adj.</span>
          )}
        </TableCell>
        <TableCell>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusBadgeClasses[status])}>
            {stockStatusLabel(status)}
          </span>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {row.productBatches.length}
          {nearest !== null ? ` · ${nearest} days` : ""}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {formatNaira(row.effectiveStock * row.product.costPerBaseUnit)}
        </TableCell>
        <TableCell className="text-right">
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={onToggleAdjust}>
            <PencilLine className="h-3.5 w-3.5" aria-hidden />
            Adjust
          </Button>
        </TableCell>
      </TableRow>
      {adjusting && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/50">
            <AdjustPanel product={row.product} onApply={onApply} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function AdjustPanel({
  product,
  onApply,
}: {
  product: Product;
  onApply: (delta: number, reason: string) => void;
}) {
  const [deltaText, setDeltaText] = useState("");
  const [reason, setReason] = useState(adjustmentReasons[0]!);
  const delta = Number.parseInt(deltaText, 10);

  return (
    <form
      className="flex flex-wrap items-end gap-2 py-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!Number.isFinite(delta) || delta === 0) {
          toast.error("Enter a non-zero adjustment in base units");
          return;
        }
        onApply(delta, reason);
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={`delta-${product.id}`} className="text-xs font-medium text-muted-foreground">
          Adjustment ({product.baseUnitLabel}s, +/−)
        </label>
        <Input
          id={`delta-${product.id}`}
          type="number"
          inputMode="numeric"
          placeholder="e.g. -20"
          value={deltaText}
          onChange={(e) => setDeltaText(e.target.value)}
          className="h-9 w-36 tabular-nums"
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Reason</span>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger className="h-9 w-48 text-sm" aria-label="Adjustment reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {adjustmentReasons.map((r) => (
              <SelectItem key={r} value={r} className="text-sm">
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" size="sm" className="h-9">
        Apply
      </Button>
      <p className="w-full text-xs text-muted-foreground">
        Current: {baseStockLabel(product)} — adjustments are entered in base units.
      </p>
    </form>
  );
}
