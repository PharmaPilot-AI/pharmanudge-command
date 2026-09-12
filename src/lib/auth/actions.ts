import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServerSupabaseEnv } from "../supabase/server-env";
import { createServerSupabaseClient } from "../supabase/server";
import { clearSessionCookie, readSessionData, writeSessionData } from "./session";
import { getSiteUrl } from "./site-url";

/**
 * A fresh, never-persisted anon-key client for the password-recovery flow.
 * `flowType: "pkce"` ensures the recovery email link carries an opaque,
 * single-use `code` query param rather than access/refresh tokens in a URL
 * fragment — the browser only ever sees that code, never a real Supabase
 * token, preserving this app's server-only token handling (no parallel
 * browser/localStorage Supabase session, matching src/lib/supabase/client.ts
 * remaining unused for auth purposes).
 */
function createRecoveryClient() {
  const env = getServerSupabaseEnv();
  return createClient(env.APP_SUPABASE_URL, env.APP_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Deliberately generic — never distinguishes "no such user" from "wrong
 * password", to avoid account enumeration.
 */
const GENERIC_LOGIN_ERROR = "Invalid email or password.";

export const loginAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => loginSchema.parse(input))
  .handler(async ({ data }) => {
    const client = createServerSupabaseClient();
    const result = await client.auth
      .signInWithPassword({ email: data.email, password: data.password })
      .catch(() => null);

    const session = result && !result.error ? result.data.session : null;
    if (!session) {
      throw new Error(GENERIC_LOGIN_ERROR);
    }

    await writeSessionData({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    });
  });

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

/**
 * Always succeeds from the caller's perspective, regardless of whether the
 * email belongs to an account — never reveals which emails exist.
 */
export const requestPasswordResetAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => forgotPasswordSchema.parse(input))
  .handler(async ({ data }) => {
    const client = createRecoveryClient();
    await client.auth
      .resetPasswordForEmail(data.email, { redirectTo: `${getSiteUrl()}/reset-password` })
      .catch(() => undefined);
  });

const resetPasswordSchema = z.object({
  code: z.string().min(1),
  newPassword: z.string().min(8),
});

/**
 * Deliberately generic — an invalid, expired, or already-used recovery code
 * all produce the same message, never distinguished.
 */
const GENERIC_RESET_ERROR =
  "This password reset link is invalid or has expired. Please request a new one.";

export const completePasswordResetAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => resetPasswordSchema.parse(input))
  .handler(async ({ data }) => {
    const client = createRecoveryClient();

    // Exchanges the one-time code for a recovery session entirely
    // server-side — this is the server-only substitute for the client-side
    // PASSWORD_RECOVERY auth-state event: only a genuinely valid, unexpired,
    // unused code reaches the updateUser call below.
    const exchange = await client.auth.exchangeCodeForSession(data.code).catch(() => null);
    if (!exchange || exchange.error || !exchange.data.session) {
      throw new Error(GENERIC_RESET_ERROR);
    }

    const update = await client.auth.updateUser({ password: data.newPassword }).catch(() => null);
    if (!update || update.error) {
      throw new Error(GENERIC_RESET_ERROR);
    }
    // The recovery session lived only on this ephemeral, never-persisted
    // client instance — nothing was ever written to a cookie or elsewhere,
    // so there is nothing further to clear once this handler returns.
  });

export const logoutAction = createServerFn({ method: "POST" }).handler(async () => {
  const session = await readSessionData();

  if (session) {
    const client = createServerSupabaseClient();
    // Revokes this specific access token's refresh token server-side via
    // the public /auth/v1/logout endpoint, using the token itself as the
    // request's bearer credential — verified against the installed
    // @supabase/auth-js source to require no service-role credential.
    // Best-effort: the cookie is cleared below regardless of the outcome.
    await client.auth.admin.signOut(session.access_token, "global").catch(() => undefined);
  }

  await clearSessionCookie();
});
