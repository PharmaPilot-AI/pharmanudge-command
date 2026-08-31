import { roleDefaults } from "../app-mode";
import type { Role } from "../types";

/**
 * The complete, router-derived allow-list for the post-login `redirect`
 * search param — every existing route except /login. Exact-match only: no
 * prefix matching, no regex, no decoding tricks. Any value not exactly one
 * of these is rejected.
 */
const ALLOWED_REDIRECTS = [
  "/",
  "/actions",
  "/ask-ai",
  "/close-day",
  "/expenses",
  "/expiry",
  "/inventory",
  "/inventory-ops",
  "/money",
  "/packaging",
  "/pos",
  "/products",
  "/receive-stock",
  "/reports",
  "/services",
  "/users",
] as const;

export function isAllowedRedirect(path: string): boolean {
  return (ALLOWED_REDIRECTS as readonly string[]).includes(path);
}

/** Role-appropriate default home, falling back to "/" when the role isn't
 * yet resolvable. */
export function resolveHome(role: Role | undefined): string {
  if (!role) return "/";
  return roleDefaults[role]?.home ?? "/";
}
