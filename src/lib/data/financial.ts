import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { financialSummarySchema, reportPeriodSchema, type ReportPeriod } from "./financial-schema";

export async function getPharmacyFinancialSummary(period: ReportPeriod) {
  const reportPeriod = reportPeriodSchema.parse(period);
  const session = await resolveSessionUser();

  if (!session) throw new Error("Please sign in to view financial reports.");

  const client = createServerSupabaseClient(session.accessToken);
  const context = await requirePharmacyContext(client);

  if (context.role !== "owner" && context.role !== "accountant") {
    throw new Error("Only an active owner or accountant can view financial reports.");
  }

  const { data, error } = await client.rpc("get_pharmacy_financial_summary", {
    target_pharmacy_id: context.pharmacyId,
    report_period: reportPeriod,
  });

  if (error || !data) {
    throw new Error("Unable to load financial reports. Please try again.");
  }

  const parsed = financialSummarySchema.safeParse(data);
  if (!parsed.success || parsed.data.period !== reportPeriod) {
    throw new Error("Financial reporting returned an invalid response.");
  }

  return parsed.data;
}
