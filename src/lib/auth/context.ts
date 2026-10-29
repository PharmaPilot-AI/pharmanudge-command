import "@tanstack/react-start/server-only";
import { createClient } from "@supabase/supabase-js";
import { getRequest } from "@tanstack/react-start/server";
import { getServerSupabaseEnv } from "../supabase/server-env";
import type { Database } from "../supabase/database.types";
import {
  clearSessionCookie,
  readSessionData,
  writeSessionData,
  type SessionTokens,
} from "./session";

/** How far ahead of expiry to proactively refresh. */
const REFRESH_SAFETY_MARGIN_SECONDS = 60;

export interface ResolvedSessionUser {
  accessToken: string;
  userId: string;
  email: string | undefined;
}

/**
 * Per-request memoization, keyed on the incoming Request. A single request
 * can drive several Supabase calls (e.g. getPharmacyContext() alone makes
 * two); without this, each would independently detect a near-expiry token
 * and attempt its own refresh — and since Supabase refresh tokens rotate on
 * use (enable_refresh_token_rotation = true), a second concurrent refresh
 * using the now-already-consumed refresh token would fail. Memoizing
 * guarantees exactly one resolution (and at most one refresh) per request.
 */
const resolutionCache = new WeakMap<Request, Promise<ResolvedSessionUser | undefined>>();

/**
 * A plain, anon-key-only client with no dynamic token injection —
 * deliberately not createServerSupabaseClient(), to avoid recursively
 * re-entering session resolution while a resolution is already in flight
 * (createServerSupabaseClient()'s default path calls resolveSessionUser()).
 */
function createRefreshClient() {
  const env = getServerSupabaseEnv();
  return createClient<Database>(env.APP_SUPABASE_URL, env.APP_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Portable base64url decode (no Node Buffer — this app's Nitro build
 * targets Cloudflare Workers, which has no Buffer global).
 */
function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Reads id/email off the access token's own claims. Not a signature
 * verification — safe here because the token only ever reaches this code
 * after passing the sealed session cookie's own tamper-evident encryption
 * (Checkpoint 2); a forged token without the correct SESSION_SECRET would
 * fail to unseal before this is ever called. Used for display only
 * (Checkpoint 7) — authorization always goes through RLS via the token
 * itself, never through this decoded value.
 */
function decodeAccessTokenClaims(
  accessToken: string,
): { userId: string; email: string | undefined } | undefined {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return undefined;

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as Record<string, unknown>;
    const userId = typeof payload["sub"] === "string" ? payload["sub"] : undefined;
    const email = typeof payload["email"] === "string" ? payload["email"] : undefined;
    return userId ? { userId, email } : undefined;
  } catch {
    return undefined;
  }
}

async function resolveSessionUserUncached(): Promise<ResolvedSessionUser | undefined> {
  const tokens = await readSessionData();
  if (!tokens) return undefined;

  const nowSeconds = Math.floor(Date.now() / 1000);
  let active: SessionTokens = tokens;

  if (tokens.expires_at <= nowSeconds + REFRESH_SAFETY_MARGIN_SECONDS) {
    const result = await createRefreshClient()
      .auth.refreshSession({ refresh_token: tokens.refresh_token })
      .catch(() => null);

    const session = result && !result.error ? result.data.session : null;
    if (!session) {
      await clearSessionCookie();
      return undefined;
    }

    active = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? nowSeconds + session.expires_in,
    };
    await writeSessionData(active);
  }

  const claims = decodeAccessTokenClaims(active.access_token);
  if (!claims) {
    await clearSessionCookie();
    return undefined;
  }

  return { accessToken: active.access_token, userId: claims.userId, email: claims.email };
}

/**
 * Resolves (and, when needed, refreshes) the current request's session.
 * Never throws — a missing session, an unseal failure, or a failed refresh
 * all resolve to undefined, with the session cookie actively cleared on the
 * latter two so a corrupted/expired session never lingers. Memoized once
 * per request (see resolutionCache above) — safe to call from multiple
 * places within the same request.
 */
export function resolveSessionUser(): Promise<ResolvedSessionUser | undefined> {
  const request = getRequest();
  const cached = resolutionCache.get(request);
  if (cached) return cached;

  const promise = resolveSessionUserUncached();
  resolutionCache.set(request, promise);
  return promise;
}
