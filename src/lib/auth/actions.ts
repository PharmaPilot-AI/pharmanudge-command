import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createServerSupabaseClient } from "../supabase/server";
import { clearSessionCookie, readSessionData, writeSessionData } from "./session";

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
