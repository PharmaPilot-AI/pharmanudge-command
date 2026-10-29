import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Cash reconciliation state: balanced, short, or over.
 * Variance = counted − expected.
 */
export function ReconciliationBadge({
  variance,
  className,
}: {
  variance: number;
  className?: string;
}) {
  const config =
    variance === 0
      ? { label: "Balanced", classes: "border-success/30 bg-success/10 text-success" }
      : variance < 0
        ? {
            label: `Short ${formatNaira(Math.abs(variance))}`,
            classes: "border-destructive/30 bg-destructive/10 text-destructive",
          }
        : {
            label: `Over ${formatNaira(variance)}`,
            classes: "border-warning/40 bg-warning/10 text-warning",
          };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        config.classes,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {config.label}
    </span>
  );
}
