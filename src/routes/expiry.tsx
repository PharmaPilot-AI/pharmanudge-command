import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarClock, RotateCcw, Tag } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { batches, productById } from "@/lib/mock-data";
import { expiryTone, expiryToneLabel, formatNaira, type ExpiryTone } from "@/lib/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/expiry")({
  head: () => ({
    meta: [
      { title: "Expiry Center — PharmaPilot AI" },
      { name: "description", content: "Batch-level expiry tracking: what expires when, and the stock value at risk." },
      { property: "og:title", content: "Expiry Center — PharmaPilot AI" },
      { property: "og:description", content: "Batch-level expiry tracking and value at risk." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ExpiryCenter,
});

const toneClasses: Record<ExpiryTone, string> = {
  expired: "bg-destructive/10 text-destructive",
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  ok: "bg-success/10 text-success",
};

/** Batch-level expiry tracking with value at risk and flag-for-return actions. */
function ExpiryCenter() {
  const [flagged, setFlagged] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...batches].sort((a, b) => a.daysToExpiry - b.daysToExpiry),
    [],
  );
  const atRisk = sorted.filter((b) => b.daysToExpiry <= 30);
  const atRiskValue = atRisk.reduce((s, b) => s + b.baseUnitsRemaining * b.costPerBaseUnit, 0);

  const toggleFlag = (id: string, label: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    toast.success(`${flagged.has(id) ? "Removed return flag" : "Flagged for supplier return"}: ${label}`);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Expiry Center"
        description="Every batch, sorted by urgency. Act before stock becomes a loss."
      />

      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Expire ≤ 30 days" value={String(atRisk.length)} tone="danger" />
        <SummaryTile
          label="Expire ≤ 90 days"
          value={String(sorted.filter((b) => b.daysToExpiry > 30 && b.daysToExpiry <= 90).length)}
          tone="warning"
        />
        <SummaryTile label="Value at risk" value={formatNaira(atRiskValue)} tone="warning" small />
      </div>

      <div className="flex flex-col gap-2">
        {sorted.map((b) => {
          const product = productById(b.productId);
          const tone = expiryTone(b.daysToExpiry);
          const isFlagged = flagged.has(b.id);
          return (
            <div key={b.id} className="rounded-xl border bg-card p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{product?.name ?? b.productId}</p>
                  <p className="text-xs text-muted-foreground">
                    Batch {b.batchNumber} · {b.supplier} · expires {b.expiryDate}
                  </p>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", toneClasses[tone])}>
                  {b.daysToExpiry < 0 ? "Expired" : `${b.daysToExpiry} days`} · {expiryToneLabel(tone)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
                <span>{b.baseUnitsRemaining.toLocaleString("en-US")} {product?.baseUnitLabel ?? "unit"}s left</span>
                <span>Value at risk: <span className="font-semibold text-foreground">{formatNaira(b.baseUnitsRemaining * b.costPerBaseUnit)}</span></span>
                {isFlagged && <span className="font-semibold text-info">Flagged for return</span>}
              </div>
              <div className="mt-2.5 flex gap-2">
                <Button
                  variant={isFlagged ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => toggleFlag(b.id, `${product?.name ?? "Batch"} ${b.batchNumber}`)}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  {isFlagged ? "Return flagged" : "Flag for return"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1 text-xs"
                  onClick={() => toast.success("Added to clearance list (Phase 1 mock)")}
                >
                  <Tag className="h-3.5 w-3.5" aria-hidden />
                  Mark for clearance
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" aria-hidden />
        Days-to-expiry is precomputed in this Phase 1 mock; the backend will derive it live.
      </p>
    </div>
  );
}

function SummaryTile({ label, value, tone, small }: { label: string; value: string; tone: "danger" | "warning"; small?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-bold tabular-nums",
          small ? "text-lg sm:text-xl" : "text-2xl",
          tone === "danger" ? "text-destructive" : "text-warning",
        )}
      >
        {value}
      </p>
    </div>
  );
}
