/**
 * Placeholder for Supabase's generated database types.
 *
 * This file will be overwritten by `supabase gen types typescript` once the
 * project is linked (a later, separately-approved checkpoint). No schema
 * exists yet, so every table/view/function map is empty.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
