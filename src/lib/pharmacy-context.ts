import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSessionUser } from "./auth/context";
import { createServerSupabaseClient } from "./supabase/server";
import type { Database } from "./supabase/database.types";

export interface PharmacyContext {
  userId: string;
  pharmacyId: string;
  role: Database["public"]["Enums"]["pharmacy_role"];
}

/**
 * Resolves the calling user's active pharmacy membership and role.
 *
 * Fails closed (returns null) for: no authenticated user, no active
 * membership, an inactive pharmacy, or more than one matching active
 * membership (ambiguous). Relies entirely on RLS via the caller's session —
 * never uses service-role credentials.
 */
export async function getPharmacyContext(
  client?: SupabaseClient<Database>,
): Promise<PharmacyContext | null> {
  // TEMPORARY DIAGNOSTIC LOGGING throughout this function — remove after
  // root-causing the /products "No active pharmacy membership" investigation.
  // Fixed labels, booleans, counts, and error codes/status only — never
  // cookie/token/session values or PII.
  //
  // Resolved here, at this function's own top-level execution, rather than
  // left to createServerSupabaseClient()'s lazy per-fetch resolution — that
  // lazy path calls resolveSessionUser() from inside a callback supabase-js
  // invokes internally, which loses this app's AsyncLocalStorage-based
  // request context on Cloudflare Workers, silently resolving as
  // unauthenticated. Resolving synchronously up front, the same way
  // __root.tsx already does, avoids that boundary entirely.
  const usedExplicitClient = client !== undefined;
  let resolvedClient = client;
  let hadResolvedToken: boolean | undefined;
  if (!resolvedClient) {
    const resolvedAccessToken = (await resolveSessionUser())?.accessToken;
    hadResolvedToken = !!resolvedAccessToken;
    resolvedClient = createServerSupabaseClient(resolvedAccessToken);
  }
  console.error("[DIAG][pharmacy-context] client_resolution", {
    usedExplicitClient,
    hadResolvedToken,
  });

  const { data: userData, error: userError } = await resolvedClient.auth.getUser();
  if (userError || !userData.user) {
    console.error("[DIAG][pharmacy-context] auth_getUser_failed", {
      hadError: !!userError,
      errorStatus: userError ? (userError as { status?: number }).status : undefined,
      hasUser: !!userData?.user,
    });
    return null;
  }

  const { data, error } = await resolvedClient
    .from("pharmacy_members")
    .select("pharmacy_id, role, pharmacies!inner(is_active)")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .eq("pharmacies.is_active", true);

  if (error || !data || data.length !== 1) {
    console.error("[DIAG][pharmacy-context] membership_query_failed", {
      hadError: !!error,
      errorCode: error ? (error as { code?: string }).code : undefined,
      rowCount: data ? data.length : undefined,
    });
    return null;
  }

  const membership = data[0]!;
  return {
    userId: userData.user.id,
    pharmacyId: membership.pharmacy_id,
    role: membership.role,
  };
}

/**
 * Same resolution as getPharmacyContext(), but throws instead of returning
 * null. Use this where a missing/ambiguous pharmacy context must propagate
 * as a failure rather than be silently treated as "no data".
 */
export async function requirePharmacyContext(
  client?: SupabaseClient<Database>,
): Promise<PharmacyContext> {
  const ctx = await getPharmacyContext(client);
  if (!ctx) throw new Error("No active pharmacy membership for the current user.");
  return ctx;
}
