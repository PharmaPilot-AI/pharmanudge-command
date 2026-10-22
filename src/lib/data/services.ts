import "@tanstack/react-start/server-only";
import { CATALOGUE_PAGE_SIZE, loadCatalogueRows } from "./catalogue-pages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSessionUser } from "../auth/context";
import { requirePharmacyContext } from "../pharmacy-context";
import { createServerSupabaseClient } from "../supabase/server";
import type { Database, Tables, TablesInsert, TablesUpdate } from "../supabase/database.types";

/**
 * Resolved here, at each function's own top-level execution, rather than
 * left to createServerSupabaseClient()'s lazy per-fetch resolution — that
 * lazy path calls resolveSessionUser() from inside a callback supabase-js
 * invokes internally, which loses this app's AsyncLocalStorage-based
 * request context on Cloudflare Workers, silently resolving as
 * unauthenticated. Resolving synchronously up front, the same way
 * __root.tsx already does, avoids that boundary entirely.
 */
async function resolveClient(client?: SupabaseClient<Database>): Promise<SupabaseClient<Database>> {
  return client ?? createServerSupabaseClient((await resolveSessionUser())?.accessToken);
}

/**
 * Lists active services for the caller's own pharmacy. Read-only. Scoped by
 * an explicit pharmacy_id filter in addition to RLS. Throws on auth/context
 * or query failure rather than returning an empty/misleading list.
 */
export async function listServices(
  client?: SupabaseClient<Database>,
): Promise<Tables<"services">[]> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId } = await requirePharmacyContext(resolvedClient);

  const data = await loadCatalogueRows(
    (afterId) => {
      let query = resolvedClient
        .from("services")
        .select("*")
        .eq("pharmacy_id", pharmacyId)
        .eq("is_active", true)
        .order("id").limit(CATALOGUE_PAGE_SIZE);
      if (afterId !== null) query = query.gt("id", afterId);
      return query;
    },
    (row) => row.id,
  );
  data.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return data;
}

/**
 * Creates a service for the caller's own pharmacy. pharmacy_id is derived
 * from the authenticated pharmacy context and is never accepted from input
 * — the input type structurally excludes it.
 */
export async function createService(
  input: Omit<TablesInsert<"services">, "pharmacy_id">,
  client?: SupabaseClient<Database>,
): Promise<Tables<"services">> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId } = await requirePharmacyContext(resolvedClient);

  const { data, error } = await resolvedClient
    .from("services")
    .insert({ ...input, pharmacy_id: pharmacyId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Updates a service, explicitly scoped to the caller's own pharmacy in
 * addition to RLS. pharmacy_id and id are structurally excluded from the
 * input type — neither can be changed via this function.
 */
export async function updateService(
  serviceId: string,
  input: Partial<Omit<TablesUpdate<"services">, "pharmacy_id" | "id">>,
  client?: SupabaseClient<Database>,
): Promise<Tables<"services">> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId } = await requirePharmacyContext(resolvedClient);

  const { data, error } = await resolvedClient
    .from("services")
    .update(input)
    .eq("id", serviceId)
    .eq("pharmacy_id", pharmacyId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Deletes a service, explicitly scoped to the caller's own pharmacy in
 * addition to RLS. Throws if no matching row was deleted (not found, or
 * not owned by this pharmacy) rather than silently succeeding.
 */
export async function deleteService(
  serviceId: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const resolvedClient = await resolveClient(client);
  const { pharmacyId } = await requirePharmacyContext(resolvedClient);

  const { data, error } = await resolvedClient
    .from("services")
    .delete()
    .eq("id", serviceId)
    .eq("pharmacy_id", pharmacyId)
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Service not found for this pharmacy.");
  }
}
