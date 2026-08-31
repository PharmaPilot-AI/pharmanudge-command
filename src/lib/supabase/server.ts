import "@tanstack/react-start/server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getRequestHeader } from "@tanstack/react-start/server";
import type { Database } from "./database.types";
import { getClientEnv } from "./env";
import { resolveSessionUser } from "../auth/context";

function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(headerValue);
  return match?.[1];
}

/**
 * Request-scoped Supabase client for server-only code (TanStack Start server
 * functions/loaders). Forwards the caller's access token — an explicit
 * argument, or read from the incoming request's Authorization header — as a
 * custom Authorization header on every Supabase request, so auth.getUser()
 * and all PostgREST queries run as that user under RLS. Uses only the
 * public anon key; never a service-role credential.
 *
 * When neither is present, each outgoing request lazily resolves (and, if
 * needed, refreshes) the caller's session cookie via resolveSessionUser()
 * and injects its access token instead — so the session cookie remains the
 * default identity for every server-side Supabase call, with no change to
 * this function's signature or its existing callers' default-parameter
 * usage (resolution happens per-outgoing-fetch, not at client construction,
 * since resolveSessionUser() is async and this function must stay sync).
 */
export function createServerSupabaseClient(accessToken?: string): SupabaseClient<Database> {
  const token = accessToken ?? extractBearerToken(getRequestHeader("authorization"));
  const env = getClientEnv();

  if (token) {
    return createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }

  return createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: async (input, init) => {
        const resolved = await resolveSessionUser();
        if (!resolved) return fetch(input, init);
        const headers = new Headers(init?.headers);
        headers.set("Authorization", `Bearer ${resolved.accessToken}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
}
