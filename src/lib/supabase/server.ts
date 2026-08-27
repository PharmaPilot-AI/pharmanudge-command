import "@tanstack/react-start/server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { Database } from "./database.types";
import { getClientEnv } from "./env";

function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue);
  return match?.[1];
}

/**
 * Request-scoped Supabase client for server-only code (TanStack Start server
 * functions/loaders). Forwards the caller's access token — read from the
 * incoming request's Authorization header — as a custom Authorization header
 * on every Supabase request, so auth.getUser() and all PostgREST queries run
 * as that user under RLS. Uses only the public anon key; never a
 * service-role credential.
 */
export function createServerSupabaseClient(accessToken?: string): SupabaseClient<Database> {
  const token = accessToken ?? extractBearerToken(getRequestHeader("authorization"));
  const env = getClientEnv();

  return createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}),
  });
}
