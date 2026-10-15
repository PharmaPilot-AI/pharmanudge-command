import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pharmacyExpensesQuery, recordPharmacyExpenseMutation } from "@/lib/data/validation";
import { EXPENSE_CATEGORIES, expenseSchema, type ExpenseInput } from "@/lib/data/expense-schema";

export const Route = createFileRoute("/expenses")({
  loader: () => pharmacyExpensesQuery(),
  head: () => ({
    meta: [
      { title: "Expenses — PharmaNudge" },
      { name: "description", content: "Record and review daily pharmacy expenses." },
    ],
  }),
  component: ExpensesPage,
});

type ExpensePageData = Awaited<ReturnType<typeof pharmacyExpensesQuery>>;
type PaymentSource = ExpenseInput["payment_source"];

const PAYMENT_LABELS: Record<PaymentSource, string> = {
  cash: "Cash",
  transfer: "Bank transfer",
  pos_card: "Card payment",
};

function formatExpenseAmount(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  return `₦${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

function ExpensesPage() {
  const data = Route.useLoaderData();
  return <ExpenseForm key={`${data.pharmacyId}:${data.userId}`} data={data} />;
}

function ExpenseForm({ data }: { data: ExpensePageData }) {
  const router = useRouter();
  const storageKey = `pharmanudge:pending-expense:${data.pharmacyId}:${data.userId}`;
  const pendingRef = useRef<ExpenseInput | null>(null);
  const submittingRef = useRef(false);
  const [pending, setPending] = useState<ExpenseInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentSource, setPaymentSource] = useState<PaymentSource>("cash");

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const request = expenseSchema.parse(JSON.parse(saved));
        pendingRef.current = request;
        setPending(request);
      }
      setStorageReady(true);
    } catch {
      setStorageError(
        "Cannot recover the saved expense. Ask the owner to review it before recording another expense.",
      );
    }
  }, [storageKey]);

  const locked = !storageReady || saving || pending !== null || refreshRequired;
  const totalKobo = data.expenses.reduce(
    (sum, expense) => sum + Math.round(Number(expense.amount) * 100),
    0,
  );
  const totalLabel = Number.isSafeInteger(totalKobo)
    ? formatExpenseAmount((totalKobo / 100).toFixed(2))
    : "Total too large to display safely";

  const refreshExpenses = async () => {
    setRefreshRequired(true);
    try {
      await router.invalidate();
      setRefreshRequired(false);
    } catch {
      toast.error("Refresh failed. Refresh expenses before recording another entry.");
    }
  };

  const submitExpense = async () => {
    if (submittingRef.current || !storageReady) return;
    if (!pendingRef.current && refreshRequired) return;

    submittingRef.current = true;
    setSaving(true);
    try {
      let request = pendingRef.current;
      if (!request) {
        const parsed = expenseSchema.safeParse({
          operation_id: crypto.randomUUID(),
          category,
          description,
          amount: Number(amount),
          payment_source: paymentSource,
        });
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Check the expense details.");
          return;
        }
        request = parsed.data;

        // Persist before sending; do not submit if storage fails.
        sessionStorage.setItem(storageKey, JSON.stringify(request));
        pendingRef.current = request;
        setPending(request);
      }

      const result = await recordPharmacyExpenseMutation({ data: request });
      setRefreshRequired(true);

      // Clear only after confirmed success or a definite database rejection.
      sessionStorage.removeItem(storageKey);
      pendingRef.current = null;
      setPending(null);

      if (result.status === "confirmed") {
        setDescription("");
        setAmount("");
        toast.success("Expense saved.");
      } else {
        // Restore recovered details so a rejected request can be corrected.
        setCategory(request.category);
        setDescription(request.description);
        setAmount(String(request.amount));
        setPaymentSource(request.payment_source);
        toast.error(result.message);
      }

      await refreshExpenses();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Expense recording failed.";
      toast.error(
        pendingRef.current
          ? `${message} Use Retry saved submission before recording another expense.`
          : message,
      );
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submitExpense();
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Expenses" description={`Spending for ${data.date} · Lagos time`} />

      {storageError && (
        <p
          role="alert"
          className="rounded-xl border border-destructive p-4 text-sm text-destructive"
        >
          {storageError}
        </p>
      )}

      {pending && (
        <div role="status" className="rounded-xl border p-4 text-sm">
          <p>A saved expense needs confirmation before another entry can be recorded.</p>
          <p className="mt-2 break-words">
            {pending.description} · {formatExpenseAmount(pending.amount.toFixed(2))}
            {" · "}
            {PAYMENT_LABELS[pending.payment_source]}
          </p>
          <Button
            className="mt-3"
            disabled={saving || !storageReady}
            onClick={() => void submitExpense()}
          >
            {saving ? "Confirming expense…" : "Retry saved submission"}
          </Button>
        </div>
      )}

      {refreshRequired && !pending && (
        <div role="status" className="rounded-xl border p-4 text-sm">
          <p>Refresh the list before recording another expense.</p>
          <Button className="mt-3" disabled={saving} onClick={() => void refreshExpenses()}>
            Refresh expenses
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden />
            Add expense
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit}>
            <fieldset disabled={locked} className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-category">Category</Label>
                <Select value={category} onValueChange={setCategory} disabled={locked}>
                  <SelectTrigger id="ex-category" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-payment">Paid from</Label>
                <Select
                  value={paymentSource}
                  disabled={locked}
                  onValueChange={(value) => {
                    if (value === "cash" || value === "transfer" || value === "pos_card") {
                      setPaymentSource(value);
                    }
                  }}
                >
                  <SelectTrigger id="ex-payment" className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["cash", "transfer", "pos_card"] as const).map((value) => (
                      <SelectItem key={value} value={value}>
                        {PAYMENT_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="ex-desc">Description</Label>
                <Input
                  id="ex-desc"
                  required
                  maxLength={500}
                  placeholder="e.g. Generator fuel"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="h-11"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ex-amount">Amount (₦)</Label>
                <Input
                  id="ex-amount"
                  type="number"
                  required
                  min="0.01"
                  max="999999999999.99"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="h-11 tabular-nums"
                />
              </div>
              <Button type="submit" disabled={locked} className="h-11 sm:self-end">
                {saving ? "Saving…" : "Record expense"}
              </Button>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <section aria-label="Daily expenses">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Recorded expenses</h2>
          <p className="text-sm font-semibold tabular-nums">Total: {totalLabel}</p>
        </div>
        {data.expenses.length === 0 ? (
          <p className="rounded-xl border p-4 text-sm text-muted-foreground">
            No expenses recorded for this day.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.expenses.map((expense) => (
              <div key={expense.expense_id} className="rounded-xl border bg-card p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold">{expense.description}</p>
                  <p className="text-sm font-bold tabular-nums">
                    {formatExpenseAmount(expense.amount)}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {expense.category} ·{" "}
                  {PAYMENT_LABELS[expense.payment_source as PaymentSource] ??
                    expense.payment_source}
                  {" · "}
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Africa/Lagos",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: true,
                  }).format(new Date(expense.spent_at))}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  Recorded by: {expense.recorded_by === data.userId ? "You" : expense.recorded_by}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
