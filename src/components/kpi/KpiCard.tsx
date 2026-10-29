import { Link, type LinkProps } from "@tanstack/react-router";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export type KpiTone = "default" | "success" | "warning" | "danger";

const toneIconClasses: Record<KpiTone, string> = {
  default: "bg-secondary text-secondary-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
};

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  /** Signed percent change vs yesterday; renders a trend chip. */
  deltaPct?: number;
  icon: LucideIcon;
  tone?: KpiTone;
  href?: LinkProps["to"];
  /** Optional footer content, e.g. a reconciliation badge. */
  footer?: ReactNode;
}

/** Reusable KPI tile — money values use tabular numerals for scannability. */
export function KpiCard({
  label,
  value,
  sub,
  deltaPct,
  icon: Icon,
  tone = "default",
  href,
  footer,
}: KpiCardProps) {
  const body = (
    <Card className={cn("h-full transition-shadow", href && "hover:shadow-md")}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span
            className={cn(
              "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
              toneIconClasses[tone],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <p className="text-xl font-bold tabular-nums tracking-tight sm:text-2xl">{value}</p>
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {typeof deltaPct === "number" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                deltaPct >= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
              )}
            >
              {deltaPct >= 0 ? (
                <TrendingUp className="h-3 w-3" />
              ) : (
                <TrendingDown className="h-3 w-3" />
              )}
              {Math.abs(deltaPct)}% vs yesterday
            </span>
          )}
          {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
        </div>
        {footer}
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
      >
        {body}
      </Link>
    );
  }
  return body;
}
