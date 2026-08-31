import "@tanstack/react-start/server-only";
import { z } from "zod";

const sessionEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32),
});

/**
 * Server-only session secret, read from process.env — never import.meta.env,
 * never VITE_-prefixed. Throws on a missing or too-short value rather than
 * falling back to a generated secret; a weak or absent secret must fail
 * loudly, not silently start the app with unprotected sessions.
 */
export function getSessionSecret(): string {
  return sessionEnvSchema.parse({
    SESSION_SECRET: process.env["SESSION_SECRET"],
  }).SESSION_SECRET;
}
