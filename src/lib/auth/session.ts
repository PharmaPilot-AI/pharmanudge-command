import "@tanstack/react-start/server-only";
import {
  clearSession,
  getCookie,
  unsealSession,
  updateSession,
  type SessionConfig,
} from "@tanstack/react-start/server";
import { getSessionSecret } from "./env";

/** Browser-visible name of the sealed session cookie. */
export const SESSION_COOKIE_NAME = "pharmapilot_session";

/** Outer defensive bound on session lifetime, independent of Supabase's own
 * refresh-token validity — 30 days. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The only Supabase session material this app's cookie ever holds. */
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function isSessionTokens(value: unknown): value is SessionTokens {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["access_token"] === "string" &&
    typeof candidate["refresh_token"] === "string" &&
    typeof candidate["expires_at"] === "number"
  );
}

/**
 * Shared session config. Cookie flags are always passed explicitly — the
 * framework's own cookie defaults have no sameSite and an unconditional
 * secure: true, neither of which is safe to rely on here (invariant 5).
 */
export function buildSessionConfig(): SessionConfig {
  return {
    password: getSessionSecret(),
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE_SECONDS,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      path: "/",
    },
  };
}

/**
 * Side-effect-free session read. Deliberately never calls
 * getSession/useSession, which auto-create an empty session and set a
 * cookie for any request that doesn't already have one — including
 * anonymous requests. Returns undefined for a missing, tampered, or
 * expired cookie; never throws.
 */
export async function readSessionData(): Promise<SessionTokens | undefined> {
  // TEMPORARY DIAGNOSTIC LOGGING — remove after root-causing the /products
  // "No active pharmacy membership" investigation. Fixed labels, booleans,
  // and error names/codes only — never cookie/token/session values.
  let cookieValue: string | undefined;
  try {
    cookieValue = getCookie(SESSION_COOKIE_NAME);
  } catch (err) {
    console.error("[DIAG][session] getCookie_threw", {
      name: err instanceof Error ? err.name : typeof err,
    });
    throw err;
  }

  if (!cookieValue) {
    console.error("[DIAG][session] no_session_cookie_present");
    return undefined;
  }

  try {
    const unsealed = await unsealSession(buildSessionConfig(), cookieValue);
    if (isSessionTokens(unsealed.data)) return unsealed.data;
    console.error("[DIAG][session] unsealed_but_shape_invalid");
    return undefined;
  } catch (err) {
    console.error("[DIAG][session] unseal_threw", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return undefined;
  }
}

/** Seals and writes the session cookie in one call. */
export async function writeSessionData(data: SessionTokens): Promise<void> {
  await updateSession<SessionTokens>(buildSessionConfig(), data);
}

/** Clears the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  await clearSession(buildSessionConfig());
}
