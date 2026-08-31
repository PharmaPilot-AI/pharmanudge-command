import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roleDefaults, useAppMode } from "@/lib/app-mode";
import { teamMembers } from "@/lib/mock-data";
import type { AppMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Real authenticated identity display + Owner↔Operations mode switch. The
 * mock user selector below is reachable only pre-authentication (e.g. on
 * /login), when useAppMode() reports no real identity — selectMember is
 * null once a real session is active, and this component never falls back
 * to it in that case. Mode is a user context choice, never inferred from
 * screen size.
 */
export function ModeSwitcher() {
  const navigate = useNavigate();
  const { member, mode, canSwitchMode, selectMember, switchMode } = useAppMode();

  const handleMemberChange = (memberId: string) => {
    if (!selectMember) return;
    const home = selectMember(memberId);
    navigate({ to: home as "/" });
  };

  const handleModeChange = (nextMode: AppMode) => {
    if (nextMode === mode) return;
    const home = switchMode(nextMode);
    navigate({ to: home as "/" });
  };

  return (
    <div className="flex items-center gap-2">
      {canSwitchMode ? (
        <div
          className="hidden items-center rounded-lg border bg-muted p-0.5 md:flex"
          role="group"
          aria-label="Switch between Owner and Operations mode"
        >
          {(["owner", "ops"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handleModeChange(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                mode === m
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "owner" ? "Owner" : "Operations"}
            </button>
          ))}
        </div>
      ) : (
        <span className="hidden rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground md:inline">
          {roleDefaults[member.role].mode === "owner" ? "Owner mode" : "Operations mode"}
        </span>
      )}

      {selectMember ? (
        <Select value={member.id} onValueChange={handleMemberChange}>
          <SelectTrigger
            className="h-9 w-auto min-w-0 gap-2 rounded-lg px-2.5 text-xs sm:text-sm"
            aria-label="Switch mock user"
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {member.initials}
            </span>
            <span className="hidden max-w-28 truncate sm:inline">
              <SelectValue />
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </SelectTrigger>
          <SelectContent align="end">
            {teamMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <span className="flex flex-col">
                  <span className="font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.roleLabel}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div
          className="flex h-9 w-auto min-w-0 items-center gap-2 rounded-lg px-2.5 text-xs sm:text-sm"
          aria-label="Signed in identity"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
            {member.initials}
          </span>
          <span className="hidden max-w-40 truncate sm:inline">
            {member.name}
            <span className="text-muted-foreground"> · {member.roleLabel}</span>
          </span>
        </div>
      )}
    </div>
  );
}
