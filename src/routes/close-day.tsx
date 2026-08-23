import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { ReconciliationBadge } from "@/components/kpi/ReconciliationBadge";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppMode } from "@/lib/app-mode";
import { todayKpis } from "@/lib/mock-data";
import { formatNaira, formatNairaSigned } from "@/lib/money";

export const Route = createFileRoute("/close-day")({
  head: () => ({
    meta: [
      { title: "Close Day — PharmaPilot AI" },
      { name: "description", content: "Count the drawer, see the variance, close the day with confidence." },
      { property: "og:title", content: "Close Day — PharmaPilot AI" },
      { property: "og:description", content: "Daily cash reconciliation and close of day." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: CloseDay,
});

/**
 * Daily reconciliation. Counted cash is entered and the variance recalculates
 * live: short / balanced / over. Closing the day is a local mock success.
 */
function CloseDay() {
  const { member } = useAppMode();
  const [countedText, setCountedText] = useState(String(todayKpis.countedCash));
  const [closed, setClosed] = useState(false);

  const counted = Number.parseFloat(countedText);
  const countedValid = Number.isFinite(counted) && counted >= 0;
  const variance = countedValid ? counted - todayKpis.expectedCash : 0;

  const closeDay = () => {
    if (!countedValid) {
      toast.error("Enter the counted cash amount first");
      return;
    }
    setClosed(true);
    toast.success("Day closed (Phase 1 mock — nothing was saved)");
  };

  if (closed) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="border-success/40">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-7 w-7" aria-hidden />
            </span>
            <h1 className="text-xl font-bold">Day closed</h1>
            <p className="text-sm text-muted-foreground">
              Sunday, 23 August 2026 · closed by {member.name}
            </p>
            <dl className="mt-2 w-full max-w-xs flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total sales</dt>
                <dd className="font-semibold tabular-nums">{formatNaira(todayKpis.salesTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Cash variance</dt>
                <dd className="font-semibold tabular-nums">{formatNairaSigned(variance)}</dd>
              </div>
            </dl>
            <ReconciliationBadge variance={variance} />
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setClosed(false)}>
              Reopen (mock)
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Close Day" description="Count the drawer, check the variance, close with confidence." />

      {/* Sales breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Today's takings</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Cash sales (expected in drawer)" value={formatNaira(todayKpis.expectedCash)} />
            <Row label="Bank transfers" value={formatNaira(96900)} />
            <Row label="POS card payments" value={formatNaira(41500)} />
            <div className="flex justify-between border-t pt-2 font-semibold">
              <dt>Total sales</dt>
              <dd className="tabular-nums">{formatNaira(todayKpis.salesTotal)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Cash count */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold">Cash count</CardTitle>
            {countedValid && <ReconciliationBadge variance={variance} />}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="counted-cash">Counted cash in drawer (₦)</Label>
            <Input
              id="counted-cash"
              type="number"
              min={0}
              inputMode="numeric"
              value={countedText}
              onChange={(e) => setCountedText(e.target.value)}
              className="h-12 max-w-xs text-lg font-semibold tabular-nums"
            />
          </div>
          {countedValid && (
            <p className="text-sm text-muted-foreground">
              Expected {formatNaira(todayKpis.expectedCash)} · Variance{" "}
              <span className="font-semibold text-foreground">{formatNairaSigned(variance)}</span>
              {variance < 0 && " — re-count with the cashier and check late refunds before closing."}
              {variance > 0 && " — more cash than expected; check for unrecorded sales."}
              {variance === 0 && " — the drawer matches exactly."}
            </p>
          )}
          <Button onClick={closeDay} className="h-12 w-full gap-2 text-base font-semibold sm:w-auto">
            <LockKeyhole className="h-5 w-5" aria-hidden />
            Close day
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
