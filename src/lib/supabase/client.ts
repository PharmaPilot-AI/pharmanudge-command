import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getClientEnv } from "./env";

const env = getClientEnv();

/**
 * Browser Supabase client. Uses the anon key only — safe to import from
 * routes/components. Data access is protected by RLS, not by this file.
 */
export const supabase = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
