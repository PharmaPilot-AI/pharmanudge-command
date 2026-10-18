import "@tanstack/react-start/server-only";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import { askAiInputSchema } from "./ask-ai-schema";
import { getAskAiContext } from "./ask-ai-context";
import {
  isPharmaNudgeConfigured,
  requestPharmaNudgeAdvice,
  type AiGatewayResult,
} from "./ask-ai-gateway";

export type AskAiResponse = {
  evidence: Awaited<ReturnType<typeof getAskAiContext>>;
  advice: AiGatewayResult;
};

/** Read-only advisory except for the existing atomic usage reservation. */
export async function askPharmaNudge(input: unknown): Promise<AskAiResponse> {
  const parsed = askAiInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      "Enter a business-only question (1–1000 characters) and a valid period. Do not include personal or clinical information.",
    );
  }
  const session = await resolveSessionUser();
  if (!session) throw new Error("Please sign in to ask PharmaNudge.");
  const client = createServerSupabaseClient(session.accessToken);
  let context;
  try {
    context = await requirePharmacyContext(client);
  } catch {
    throw new Error("Unable to verify active owner access to Ask PharmaNudge.");
  }
  if (context.role !== "owner" || context.userId !== session.userId) {
    throw new Error("Only an active owner can use Ask PharmaNudge.");
  }
  let evidence;
  try {
    evidence = await getAskAiContext(parsed.data.period, context);
  } catch {
    throw new Error("Unable to load verified business evidence. Please try again.");
  }
  if (!isPharmaNudgeConfigured()) {
    return { evidence, advice: { status: "unavailable", reason: "configuration" } };
  }
  // Revalidate membership after the separate evidence reads. The reservation
  // RPC also checks active owner membership atomically; never retry it.
  try {
    const current = await requirePharmacyContext(client);
    if (
      current.role !== "owner" ||
      current.userId !== context.userId ||
      current.pharmacyId !== context.pharmacyId
    ) {
      return { evidence, advice: { status: "unavailable", reason: "reservation" } };
    }
    const { data, error } = await client.rpc("reserve_pharmacy_ai_request", {
      target_pharmacy_id: context.pharmacyId,
    });
    if (error) return { evidence, advice: { status: "unavailable", reason: "reservation" } };
    if (data === "daily_limit")
      return { evidence, advice: { status: "unavailable", reason: "usage_limit" } };
    if (data === "rate_limit")
      return { evidence, advice: { status: "unavailable", reason: "rate_limit" } };
    if (data !== "allowed")
      return { evidence, advice: { status: "unavailable", reason: "reservation" } };
  } catch {
    return { evidence, advice: { status: "unavailable", reason: "reservation" } };
  }
  try {
    return { evidence, advice: await requestPharmaNudgeAdvice(parsed.data.question, evidence) };
  } catch {
    return { evidence, advice: { status: "unavailable", reason: "provider" } };
  }
}
