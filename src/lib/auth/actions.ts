import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServerSupabaseEnv } from "../supabase/server-env";
import { createServerSupabaseClient } from "../supabase/server";
import { clearSessionCookie, readSessionData, writeSessionData } from "./session";
import { getSiteUrl } from "./site-url";

/** Fresh server-only client for recovery-token verification. */
function createRecoveryClient() {
  const env = getServerSupabaseEnv();
  return createClient(env.APP_SUPABASE_URL, env.APP_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
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
  tokenHash: z.string().min(1).max(256),
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

    // Verify the recovery token only on explicit password submission.
    const exchange = await client.auth
      .verifyOtp({ token_hash: data.tokenHash, type: "recovery" })
      .catch(() => null);
    if (!exchange || exchange.error || !exchange.data.session) {
      throw new Error(GENERIC_RESET_ERROR);
    }

    const update = await client.auth.updateUser({ password: data.newPassword }).catch(() => null);
    if (!update || update.error) {
      throw new Error(GENERIC_RESET_ERROR);
    }
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
    await clearSessionCookie();
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

// --- Staff account registration and email verification ---

const staffRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(128),
  invitation: z.string().uuid(),
});

export const registerStaffAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => staffRegistrationSchema.parse(input))
  .handler(async ({ data }) => {
    const client = createRecoveryClient();
    const confirmationUrl = new URL("/confirm-email", getSiteUrl());
    confirmationUrl.searchParams.set("invitation", data.invitation);

    const result = await client.auth
      .signUp({
        email: data.email,
        password: data.password,
        options: { emailRedirectTo: confirmationUrl.toString() },
      })
      .catch(() => null);

    if (!result || result.error) {
      throw new Error("Unable to create an account. Try again or sign in if you already have one.");
    }

    // Registration creates no pharmacy membership and writes no login cookie.
  });

const confirmStaffEmailSchema = z.object({
  tokenHash: z.string().min(1).max(256),
});

export const confirmStaffEmailAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => confirmStaffEmailSchema.parse(input))
  .handler(async ({ data }) => {
    const client = createRecoveryClient();
    const result = await client.auth
      .verifyOtp({
        token_hash: data.tokenHash,
        type: "email",
      })
      .catch(() => null);

    const session = result && !result.error ? result.data.session : null;
    if (!session || !result?.data.user?.email_confirmed_at) {
      throw new Error("This verification link is invalid or has expired.");
    }

    await writeSessionData({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
    });
  });
