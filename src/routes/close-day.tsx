import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { pharmacyDaySummaryQuery, closePharmacyDayMutation } from "@/lib/data/validation";
import { closeDaySchema, type CloseDayInput } from "@/lib/data/day-closing-schema";

export const Route = createFileRoute("/close-day")({
  beforeLoad: ({ context }) => {
    const role = context.pharmacyContext?.role;
    if (role !== "owner" && role !== "accountant") {
      throw redirect({ to: "/pos" });
    }
  },
  loader: () => pharmacyDaySummaryQuery(),
  head: () => ({
    meta: [
      { title: "Close Day — PharmaNudge" },
      { name: "description", content: "Review daily takings and reconcile the cash drawer." },
    ],
  }),
  component: CloseDayPage,
});

type PageData = Awaited<ReturnType<typeof pharmacyDaySummaryQuery>>;
const hundred = BigInt(100);

function kobo(value: string): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const result = BigInt(whole) * hundred + BigInt(fraction.padEnd(2, "0"));
  return negative ? -result : result;
}

function money(value: bigint): string {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const whole = (absolute / hundred).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % hundred).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₦${whole}.${fraction}`;
}

function validCash(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) < 1000000000000;
}

function CloseDayPage() {
  const data = Route.useLoaderData();
  return <ClosingForm key={`${data.pharmacyId}:${data.userId}`} data={data} />;
}

function ClosingForm({ data }: { data: PageData }) {
  const router = useRouter();
  const saveClosing = useServerFn(closePharmacyDayMutation);
  const storageKey = `pharmanudge:pending-closing:${data.pharmacyId}:${data.userId}`;
  const pendingRef = useRef<CloseDayInput | null>(null);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<CloseDayInput | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [opening, setOpening] = useState("");
  const [counted, setCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const input = closeDaySchema.parse(JSON.parse(saved));
        pendingRef.current = input;
        setPending(input);
        setOpening(String(input.opening_cash));
        setCounted(String(input.counted_cash));
        setNotes(input.notes);
      }
      setReady(true);
    } catch {
      setStorageError(
        "Saved closing information could not be read. Closing is blocked until this is resolved.",
      );
    }
  }, [storageKey]);

  const closure = data.closure;
  const totals = closure ?? data.totals;
  const cashSales = kobo(totals.cash_sales);
  const cashExpenses = kobo(totals.cash_expenses);
  const salesTotal = cashSales + kobo(totals.transfer_sales) + kobo(totals.card_sales);
  const expensesTotal = cashExpenses + kobo(totals.transfer_expenses) + kobo(totals.card_expenses);
  const openingValid = validCash(opening);
  const countedValid = validCash(counted);
  const expected = closure
    ? kobo(closure.expected_cash)
    : openingValid
      ? kobo(opening) + cashSales - cashExpenses
      : null;
  const variance = closure
    ? kobo(closure.cash_variance)
    : expected !== null && countedValid
      ? kobo(counted) - expected
      : null;
  const locked = !ready || busy || pending !== null || refreshRequired || closure !== null;

  async function refreshSummary() {
    setRefreshRequired(true);
    try {
      await router.invalidate();
      setRefreshRequired(false);
      setAcknowledged(false);
    } catch {
      toast.error("Unable to refresh reconciliation. Refresh before continuing.");
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busyRef.current || !ready || refreshRequired) return;
    if (!pendingRef.current && (closure || !acknowledged)) return;

    busyRef.current = true;
    setBusy(true);

    try {
      let input = pendingRef.current;

      if (!input) {
        if (!openingValid || !countedValid) {
          toast.error("Enter valid opening and counted cash amounts.");
          return;
        }

        const parsed = closeDaySchema.safeParse({
          operation_id: crypto.randomUUID(),
          business_date: data.business_date,
          opening_cash: Number(opening),
          counted_cash: Number(counted),
          notes,
          reviewed_totals: data.totals,
        });

        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Review the closing details.");
          return;
        }

        input = parsed.data;
        sessionStorage.setItem(storageKey, JSON.stringify(input));
        pendingRef.current = input;
        setPending(input);
      }

      const result = await saveClosing({ data: input });

      // A definite result is available; require fresh data before another action.
      setRefreshRequired(true);
      sessionStorage.removeItem(storageKey);
      pendingRef.current = null;
      setPending(null);
      setAcknowledged(false);

      if (result.status === "confirmed") {
        toast.success("Day closed and reconciliation saved.");
      } else {
        toast.error(result.message);
      }

      await refreshSummary();
    } catch {
      toast.error(
        "Closing is not confirmed. Use Retry saved closing before attempting another closing.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title={closure ? "Day closed" : "Close Day"}
        description={`Reconciliation for ${data.business_date} · Lagos time`}
      />

      {storageError && (
        <p role="alert" className="rounded-xl border p-4">
          {storageError}
        </p>
      )}

      {pending && (
        <div role="status" className="rounded-xl border bg-card p-4">
          <p>A saved closing needs confirmation before another closing can be submitted.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {pending.business_date} · Opening {money(kobo(String(pending.opening_cash)))}
            {" · "}Counted {money(kobo(String(pending.counted_cash)))}
          </p>
          <Button
            type="button"
            className="mt-3"
            disabled={busy || refreshRequired}
            onClick={() => void submit()}
          >
            {busy ? "Confirming…" : "Retry saved closing"}
          </Button>
        </div>
      )}

      {refreshRequired && (
        <div role="alert" className="rounded-xl border p-4">
          <p>Refresh the daily figures before continuing.</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => void refreshSummary()}
          >
            Refresh reconciliation
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Daily takings and expenses</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <Row label="Cash sales" value={money(cashSales)} />
            <Row label="Bank transfer sales" value={money(kobo(totals.transfer_sales))} />
            <Row label="Card sales" value={money(kobo(totals.card_sales))} />
            <Row label={`Total sales (${totals.sale_count})`} value={money(salesTotal)} />
            <div className="my-1 border-t" />
            <Row label="Cash expenses" value={money(cashExpenses)} />
            <Row label="Bank transfer expenses" value={money(kobo(totals.transfer_expenses))} />
            <Row label="Card expenses" value={money(kobo(totals.card_expenses))} />
            <Row label={`Total expenses (${totals.expense_count})`} value={money(expensesTotal)} />
          </dl>
        </CardContent>
      </Card>

      {closure ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Saved reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Opening cash" value={money(kobo(closure.opening_cash))} />
              <Row label="Expected cash" value={money(kobo(closure.expected_cash))} />
              <Row label="Counted cash" value={money(kobo(closure.counted_cash))} />
              <Row label="Cash variance" value={money(kobo(closure.cash_variance))} />
            </dl>
            <p className="text-sm text-muted-foreground">
              Closed by{" "}
              {closure.closed_by === data.userId
                ? "You"
                : closure.closed_by_email || "Account unavailable"}
              {" · "}
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Lagos",
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(closure.closed_at))}
            </p>
            {closure.notes && <p className="whitespace-pre-wrap text-sm">{closure.notes}</p>}
            <p className="text-sm text-muted-foreground">
              New sales and expenses are blocked for this closed business day.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cash reconciliation</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-4">
              <fieldset disabled={locked} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="opening-cash">Opening cash (₦)</Label>
                    <Input
                      id="opening-cash"
                      type="number"
                      min="0"
                      max="999999999999.99"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={opening}
                      onChange={(e) => {
                        setOpening(e.target.value);
                        setAcknowledged(false);
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="counted-cash">Counted cash in drawer (₦)</Label>
                    <Input
                      id="counted-cash"
                      type="number"
                      min="0"
                      max="999999999999.99"
                      step="0.01"
                      inputMode="decimal"
                      required
                      value={counted}
                      onChange={(e) => {
                        setCounted(e.target.value);
                        setAcknowledged(false);
                      }}
                    />
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  Expected cash = opening cash + cash sales − cash expenses. Enter the actual
                  opening float; it is not carried forward automatically.
                </p>

                {expected !== null && (
                  <p className="font-semibold">Expected cash: {money(expected)}</p>
                )}
                {variance !== null && (
                  <p className="font-semibold">
                    Variance: {money(variance)}
                    {" · "}
                    {variance < BigInt(0) ? "Short" : variance > BigInt(0) ? "Over" : "Balanced"}
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  <Label htmlFor="closing-notes">Closing notes</Label>
                  <Input
                    id="closing-notes"
                    maxLength={1000}
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setAcknowledged(false);
                    }}
                  />
                </div>

                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    required
                  />
                  <span>
                    I have reviewed the figures and resolved pending sales and expenses. Closing
                    blocks new sales and expenses for this Lagos business day. Reopening is not
                    available.
                  </span>
                </label>

                <Button type="submit" disabled={!acknowledged || !openingValid || !countedValid}>
                  {busy ? "Closing…" : "Close day"}
                </Button>
              </fieldset>
            </form>

            <Button
              type="button"
              variant="outline"
              className="mt-4"
              disabled={busy || pending !== null || !ready}
              onClick={() => void refreshSummary()}
            >
              Refresh daily figures
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}
