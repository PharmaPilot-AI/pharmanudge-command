import "@tanstack/react-start/server-only";
import { z } from "zod";

const siteUrlSchema = z.object({
  SITE_URL: z.string().url(),
});

/**
 * Server-only base URL for constructing absolute redirect targets (e.g. the
 * `redirectTo` sent to Supabase for password-recovery emails). Not secret,
 * but still fails loudly on a missing/invalid value rather than guessing —
 * an incorrect redirect target here is a security-relevant misconfiguration,
 * not something to silently default around.
 */
export function getSiteUrl(): string {
  return siteUrlSchema.parse({ SITE_URL: process.env["SITE_URL"] }).SITE_URL;
}
