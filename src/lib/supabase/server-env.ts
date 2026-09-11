import "@tanstack/react-start/server-only";
import { z } from "zod";

const serverSupabaseEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerSupabaseEnv = z.infer<typeof serverSupabaseEnvSchema>;

/**
 * Server-only Supabase config, read via process.env (Lovable Cloud Secrets —
 * proven reliable, see SESSION_SECRET/SITE_URL) rather than
 * import.meta.env/VITE_-prefixed build-time injection, which Lovable's
 * production build pipeline does not reliably deliver (confirmed live: both
 * the Secrets panel and a committed .env failed to get VITE_SUPABASE_URL/
 * VITE_SUPABASE_ANON_KEY into the deployed bundle). Every consumer of this
 * function is server-only code; the one genuinely browser-side Supabase
 * client (src/lib/supabase/client.ts) remains unused per Phase 3 Decision 2
 * and keeps reading getClientEnv()/VITE_SUPABASE_* unchanged.
 */
export function getServerSupabaseEnv(): ServerSupabaseEnv {
  return serverSupabaseEnvSchema.parse({
    SUPABASE_URL: process.env["SUPABASE_URL"],
    SUPABASE_ANON_KEY: process.env["SUPABASE_ANON_KEY"],
  });
}
