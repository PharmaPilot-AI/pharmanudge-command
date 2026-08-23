import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  BarChart3,
  CalendarClock,
  CircleDollarSign,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — PharmaPilot AI" },
      { name: "description", content: "Sales, profit, inventory valuation, expiry and service revenue reports." },
      { property: "og:title", content: "Reports — PharmaPilot AI" },
      { property: "og:description", content: "Sales, profit, inventory and service revenue reports." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ReportsPage,
});

const ranges = ["Today", "This week", "This month"] as const;

const reports = [
  {
    icon: BarChart3,
    title: "Sales report",
    stats: [
      { label: "Total sales", value: formatNaira(386400) },
      { label: "Transactions", value: "87" },
    ],
  },
  {
    icon: CircleDollarSign,
    title: "Profit & margin",
    stats: [
      { label: "Gross margin", value: formatNaira(91600) },
      { label: "Margin", value: "23.7%" },
    ],
  },
  {
    icon: Wallet,
    title: "Inventory valuation",
    stats: [
      { label: "Stock value (cost)", value: formatNaira(129610) },
      { label: "SKUs tracked", value: "10" },
    ],
  },
  {
    icon: CalendarClock,
    title: "Expiry & wastage",
    stats: [
      { label: "Value at risk (≤30d)", value: formatNaira(21820) },
      { label: "Batches flagged", value: "4" },
    ],
  },
  {
    icon: Stethoscope,
    title: "Service revenue",
    stats: [
      { label: "Today", value: formatNaira(27500) },
      { label: "Share of revenue", value: "7%" },
    ],
  },
  {
    icon: Users,
    title: "Staff activity",
    stats: [
      { label: "Sales by cashier", value: "Blessing · 52" },
      { label: "Adjustments", value: "1 pending review" },
    ],
  },
];

/** Reports hub — summary cards now, full drill-down reports in Phase 2. */
function ReportsPage() {
  const [range, setRange] = useState<(typeof ranges)[number]>("Today");

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader title="Reports" description="Deeper reads on sales, profit, stock and people." />

      <div className="flex gap-1.5 rounded-lg border bg-muted p-1 sm:w-fit" role="group" aria-label="Report period">
        {ranges.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            aria-pressed={range === r}
            className={cn(
              "min-h-9 flex-1 rounded-md px-4 text-sm font-medium transition-colors sm:flex-none",
              range === r ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((report) => (
          <Card key={report.title}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <report.icon className="h-4 w-4" aria-hidden />
                </span>
                {report.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-1 text-sm">
                {report.stats.map((s) => (
                  <div key={s.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="font-medium tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => toast.info(`${report.title} (${range}) — full report arrives in Phase 2`)}
              >
                Open report
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
