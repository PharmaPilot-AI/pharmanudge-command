import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { teamMembers } from "./mock-data";
import type { AppMode, Role, TeamMember } from "./types";

/**
 * Mock user/role + mode context for Phase 1.
 *
 * Mode is a user/context concept — never derived from viewport. Real
 * authentication and server-enforced roles arrive in Phase 2; this exists so
 * the different role experiences can be tested today.
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
  /** Switch the mock signed-in user. Returns the route they should land on. */
  selectMember: (memberId: string) => string;
  /** Switch mode (owner only). Returns the route to land on. */
  switchMode: (mode: AppMode) => string;
}

const AppModeContext = createContext<AppModeContextValue | null>(null);

const defaultMember = teamMembers[0]!;

export function AppModeProvider({ children }: { children: ReactNode }) {
  const [member, setMember] = useState<TeamMember>(defaultMember);
  const [mode, setMode] = useState<AppMode>(roleDefaults[defaultMember.role].mode);

  const value = useMemo<AppModeContextValue>(
    () => ({
      member,
      mode,
      canSwitchMode: member.role === "owner",
      selectMember: (memberId) => {
        const next = teamMembers.find((m) => m.id === memberId) ?? defaultMember;
        setMember(next);
        const defaults = roleDefaults[next.role];
        setMode(defaults.mode);
        return defaults.home;
      },
      switchMode: (nextMode) => {
        setMode(nextMode);
        return nextMode === "owner" ? "/" : "/pos";
      },
    }),
    [member, mode],
  );

  return <AppModeContext.Provider value={value}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppModeContextValue {
  const ctx = useContext(AppModeContext);
  if (!ctx) throw new Error("useAppMode must be used inside AppModeProvider");
  return ctx;
}
