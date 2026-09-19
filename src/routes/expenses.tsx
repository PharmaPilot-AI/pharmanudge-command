import { createFileRoute } from "@tanstack/react-router";
import { FormEvent, useState } from "react";
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
import { useAppMode } from "@/lib/app-mode";
import { expenseCategories, initialExpenses } from "@/lib/mock-data";
import { formatNaira } from "@/lib/money";
import type { Expense } from "@/lib/types";

export const Route = createFileRoute("/expenses")({
  head: () => ({
    meta: [
      { title: "Expenses — PharmaNudge" },
      { name: "description", content: "Record and review daily pharmacy expenses." },
      { property: "og:title", content: "Expenses — PharmaNudge" },
      { property: "og:description", content: "Record and review daily pharmacy expenses." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ExpensesPage,
});

let expenseSeq = 100;

/** Expenses — local form interaction and mock list update only. */
function ExpensesPage() {
  const { member } = useAppMode();
  const [expenses, setExpenses] = useState<Expense[]>(initialExpenses);
  const [category, setCategory] = useState(expenseCategories[0]!);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  const addExpense = (e: FormEvent) => {
    e.preventDefault();
    const value = Number.parseFloat(amount);
    if (!description.trim()) {
      toast.error("Describe the expense");
      return;
    }
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setExpenses((prev) => [
      {
        id: `e${++expenseSeq}`,
        category,
        description: description.trim(),
        amount: value,
        time: "Just now",
        recordedBy: member.name,
      },
      ...prev,
    ]);
    setDescription("");
    setAmount("");
    toast.success("Expense recorded locally (Phase 1 mock)");
  };

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Expenses" description="Today's spending, recorded as it happens." />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <ReceiptText className="h-4 w-4 text-primary" aria-hidden />
            Add expense
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ex-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="ex-category" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {expenseCategories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ex-desc">Description</Label>
              <Input id="ex-desc" placeholder="e.g. Generator fuel" value={description} onChange={(e) => setDescription(e.target.value)} className="h-11" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ex-amount">Amount (₦)</Label>
              <Input id="ex-amount" type="number" min={0} inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 tabular-nums" />
            </div>
            <Button type="submit" className="h-11">Add</Button>
          </form>
        </CardContent>
      </Card>

      <section aria-label="Today's expenses">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Today</h2>
          <p className="text-sm font-semibold tabular-nums">Total: {formatNaira(total)}</p>
        </div>
        <div className="flex flex-col gap-2">
          {expenses.map((e) => (
            <div key={e.id} className="flex items-center gap-3 rounded-xl border bg-card p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{e.description}</p>
                <p className="text-xs text-muted-foreground">{e.category} · {e.time} · {e.recordedBy}</p>
              </div>
              <p className="shrink-0 text-sm font-bold tabular-nums">{formatNaira(e.amount)}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
