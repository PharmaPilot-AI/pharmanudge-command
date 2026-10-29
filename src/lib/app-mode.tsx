import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { teamMembers } from "./mock-data";
import type { AppMode, Role, TeamMember } from "./types";

/**
 * Mock user/role + mode context for Phase 1, now presentation-only for
 * identity once a real session exists.
 *
 * Mode is a user/context concept — never derived from viewport. When a real
 * authenticated identity/pharmacy_role is available (Checkpoint 5's
 * __root.tsx beforeLoad, read here via useRouteContext — never independently
 * re-resolved), member/canSwitchMode derive from it and mock identity
 * switching is disabled. The mock teamMembers fixture and Owner/Operations
 * mode concept remain unchanged and still drive the unauthenticated (/login)
 * fallback.
 */

export const roleDefaults: Record<Role, { mode: AppMode; home: string }> = {
  owner: { mode: "owner", home: "/" },
  pharmacist: { mode: "ops", home: "/pos" },
  cashier: { mode: "ops", home: "/pos" },
  accountant: { mode: "ops", home: "/reports" },
};

interface AppModeContextValue {
  member: TeamMember;
  mode: AppMode;
  /** Only the Owner can explicitly switch between Owner and Operations mode. */
  canSwitchMode: boolean;
  /** Switch the mock signed-in user. Returns the route they should land on.
   * null once a real identity is active — mock identity switching is not
   * exposed to the authenticated app. */
  selectMember: ((memberId: string) => string) | null;
  /** Switch mode (owner only). Returns the route to land on. */
  switchMode: (mode: AppMode) => string;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

const defaultMember = teamMembers[0]!;

function roleLabelFor(role: Role): string {
  return teamMembers.find((m) => m.role === role)?.roleLabel ?? role;
}

function initialsFromEmail(email: string | undefined): string {
  return email ? email.slice(0, 2).toUpperCase() : "??";
}

export function AppModeProvider({ children }: { children: ReactNode }) {
  // Reads Checkpoint 5's already-resolved router context only — never calls
  // getPharmacyContext()/resolveSessionUser() here.
  const { user, pharmacyContext } = useRouteContext({ from: "__root__" });
  const userId = user?.userId;
  const email = user?.email;
  const role = pharmacyContext?.role;
  const identity = useMemo(
    () => (userId && role ? { userId, email, role } : null),
    [userId, email, role],
  );

  const [mockMember, setMockMember] = useState<TeamMember>(defaultMember);
  const [mode, setMode] = useState<AppMode>(roleDefaults[defaultMember.role].mode);

  // Restores the owner's tab preference when a real identity
  // first becomes available (or changes) — e.g. logging in via a
  // client-side navigation, where this provider stays mounted across the
  // transition. Keyed on primitives, not the identity object (a fresh
  // object on every router-context resolution), so this doesn't re-fire on
  // every render and fight the user's own mode-toggle clicks.
  useEffect(() => {
    if (identity) {
      let restoredMode = roleDefaults[identity.role].mode;

      if (identity.role === "owner") {
        try {
          const saved = sessionStorage.getItem(`pharmanudge:app-mode:${identity.userId}`);
          if (saved === "owner" || saved === "ops") restoredMode = saved;
        } catch {
          // Storage may be unavailable; retain the role default.
        }
      }

      setMode(restoredMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.userId, identity?.role]);

  const member = useMemo<TeamMember>(
    () =>
      identity
        ? {
            id: identity.userId,
            name: identity.email ?? "Signed-in user",
            role: identity.role,
            roleLabel: roleLabelFor(identity.role),
            initials: initialsFromEmail(identity.email),
          }
        : mockMember,
    [identity, mockMember],
  );

  const canSwitchMode = identity ? identity.role === "owner" : mockMember.role === "owner";

  const value = useMemo<AppModeContextValue>(
    () => ({
      member,
      mode,
      canSwitchMode,
      selectMember: identity
        ? null
        : (memberId) => {
            const next = teamMembers.find((m) => m.id === memberId) ?? defaultMember;
            setMockMember(next);
            const defaults = roleDefaults[next.role];
            setMode(defaults.mode);
            return defaults.home;
          },
      switchMode: (nextMode) => {
        if (!canSwitchMode) return roleDefaults[member.role].home;

        if (identity?.role === "owner") {
          try {
            sessionStorage.setItem(`pharmanudge:app-mode:${identity.userId}`, nextMode);
          } catch {
            // Switching still works when storage is unavailable.
          }
        }

        setMode(nextMode);
        return nextMode === "owner" ? "/" : "/pos";
      },
    }),
    [member, mode, canSwitchMode, identity],
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error("useAppMode must be used inside AppModeProvider");
  return ctx;
}
