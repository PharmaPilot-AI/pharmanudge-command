import "@tanstack/react-start/server-only";
import { z } from "zod";

const serverSupabaseEnvSchema = z.object({
  APP_SUPABASE_URL: z.string().url(),
  APP_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerSupabaseEnv = z.infer<typeof serverSupabaseEnvSchema>;

/**
 * Server-only Supabase config, read via process.env (Lovable Cloud Secrets —
 * proven reliable, see SESSION_SECRET/SITE_URL) rather than
 * import.meta.env/VITE_-prefixed build-time injection, which Lovable's
 * production build pipeline does not reliably deliver (confirmed live: both
 * the Secrets panel and a committed .env failed to get VITE_SUPABASE_URL/
 * VITE_SUPABASE_ANON_KEY into the deployed bundle).
 *
 * Deliberately named APP_SUPABASE_URL/APP_SUPABASE_ANON_KEY, not
 * SUPABASE_URL/SUPABASE_ANON_KEY: the unprefixed names were set correctly in
 * Lovable Cloud Secrets (confirmed persisted) yet still resolved as
 * undefined at runtime in production, while SESSION_SECRET/SITE_URL — read
 * via the identical process.env mechanism — did not. The APP_ prefix avoids
 * whatever reserved/special-cased handling Lovable Cloud applies to the bare
 * "SUPABASE_" name (its "Enable more features" built-in database/auth
 * backend is Supabase-shaped, even though no integration is connected here).
 *
 * Every consumer of this function is server-only code; the one genuinely
 * browser-side Supabase client (src/lib/supabase/client.ts) remains unused
 * per Phase 3 Decision 2 and keeps reading getClientEnv()/VITE_SUPABASE_*
 * unchanged.
 */
export function getServerSupabaseEnv(): ServerSupabaseEnv {
  return serverSupabaseEnvSchema.parse({
    APP_SUPABASE_URL: process.env["APP_SUPABASE_URL"],
    APP_SUPABASE_ANON_KEY: process.env["APP_SUPABASE_ANON_KEY"],
  });
}
