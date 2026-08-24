import { z } from "zod";

const clientEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Browser-safe Supabase config. These values are bundled into client code by
 * Vite — safety comes from RLS, not from keeping these hidden.
 */
export function getClientEnv(): ClientEnv {
  return clientEnvSchema.parse({
    VITE_SUPABASE_URL: import.meta.env["VITE_SUPABASE_URL"],
    VITE_SUPABASE_ANON_KEY: import.meta.env["VITE_SUPABASE_ANON_KEY"],
  });
}
