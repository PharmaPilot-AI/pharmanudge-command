import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { expenseSchema, type ExpenseInput } from "./expense-schema";

async function expenseContext() {
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to access expenses.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);
  if (context.role !== "owner" && context.role !== "pharmacist" && context.role !== "accountant") {
    throw new Error("Only an active owner, pharmacist or accountant can access expenses.");
  }

  return { client, context };
}

export type ExpenseRecordingResult =
  { status: "confirmed"; expenseId: string } | { status: "rejected"; message: string };

export async function recordPharmacyExpense(input: ExpenseInput): Promise<ExpenseRecordingResult> {
  const expense = expenseSchema.parse(input);
  const { client, context } = await expenseContext();

  const { data, error } = await client.rpc("record_pharmacy_expense", {
    target_pharmacy_id: context.pharmacyId,
    operation_id: expense.operation_id,
    expense_category: expense.category,
    expense_description: expense.description,
    expense_amount: expense.amount,
    expense_payment_source: expense.payment_source,
  });

  if (error) {
    const expectedMessages: Record<string, readonly string[]> = {
      "22023": [
        "Valid expense details are required.",
        "Enter a positive amount with at most two decimal places.",
        "This submission reference was already used for a different expense.",
      ],
      "42501": [
        "Please sign in to record expenses.",
        "Active pharmacy not found.",
        "Only an active owner, pharmacist or accountant can record expenses.",
      ],
    };
    if (expectedMessages[error.code]?.includes(error.message)) {
      return { status: "rejected", message: error.message };
    }
    throw new Error("Unable to record expense. Please retry the same submission.");
  }

  if (!data) throw new Error("Expense recording did not return a result.");
  return { status: "confirmed", expenseId: data };
}

export async function listPharmacyExpenses() {
  const { client, context } = await expenseContext();

  // Resolve the business date once, including across paginated requests.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;

  const loadPage = (offset: number) =>
    client
      .rpc("list_pharmacy_expenses", {
        target_pharmacy_id: context.pharmacyId,
        target_date: date,
      })
      .range(offset, offset + 199);

  const first = await loadPage(0);
  if (first.error || !first.data) {
    throw new Error("Unable to load expenses. Please refresh and try again.");
  }

  const expenses = [...first.data];
  let pageLength = first.data.length;
  while (pageLength === 200) {
    const next = await loadPage(expenses.length);
    if (next.error || !next.data) {
      throw new Error("Unable to load all expenses. Please refresh and try again.");
    }
    expenses.push(...next.data);
    pageLength = next.data.length;
  }

  return {
    expenses,
    date,
    pharmacyId: context.pharmacyId,
    userId: context.userId,
    role: context.role,
  };
}
