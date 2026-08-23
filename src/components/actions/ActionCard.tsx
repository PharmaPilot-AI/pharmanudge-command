import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, Check, Clock, Info, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNaira } from "@/lib/money";
import { teamMembers } from "@/lib/mock-data";
import type { ActionItem, ActionSeverity, ActionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const severityConfig: Record<
  ActionSeverity,
  { label: string; icon: typeof Info; badge: string; rail: string }
> = {
  critical: {
    label: "Critical",
    icon: OctagonAlert,
    badge: "bg-destructive/10 text-destructive",
    rail: "border-l-destructive",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    badge: "bg-warning/10 text-warning",
    rail: "border-l-warning",
  },
  info: {
    label: "Info",
    icon: Info,
    badge: "bg-info/10 text-info",
    rail: "border-l-info",
  },
};

interface ActionCardProps {
  action: ActionItem;
  status?: ActionStatus;
  /** Management controls render only when handlers are provided (Action Center). */
  onResolve?: () => void;
  onSnooze?: () => void;
  onAssign?: (memberId: string) => void;
}

/** A single "what should I do next" item with severity, context and a CTA. */
export function ActionCard({ action, status = "open", onResolve, onSnooze, onAssign }: ActionCardProps) {
  const config = severityConfig[action.severity];
  const Icon = config.icon;
  const assignee = teamMembers.find((m) => m.id === action.assigneeId);
  const interactive = Boolean(onResolve || onSnooze || onAssign);

  return (
    <article
      className={cn(
        "rounded-xl border border-l-4 bg-card p-4",
        config.rail,
        status !== "open" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", config.badge)}>
          <Icon className="h-3 w-3" aria-hidden />
          {config.label}
        </span>
        {status !== "open" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
            {status}
          </span>
        )}
        {typeof action.amount === "number" && (
          <span className="ml-auto text-sm font-semibold tabular-nums">{formatNaira(action.amount)}</span>
        )}
      </div>

      <h3 className="mt-2 text-sm font-semibold leading-snug">{action.title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
      {assignee && (
        <p className="mt-1 text-xs text-muted-foreground">
          Assigned to <span className="font-medium text-foreground">{assignee.name}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="gap-1">
          <Link to={action.ctaPath as "/"}>
            {action.ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>

        {interactive && status === "open" && (
          <>
            <Button variant="ghost" size="sm" className="gap-1 text-success hover:text-success" onClick={onResolve}>
              <Check className="h-4 w-4" aria-hidden />
              Resolve
            </Button>
            <Button variant="ghost" size="sm" className="gap-1" onClick={onSnooze}>
              <Clock className="h-4 w-4" aria-hidden />
              Snooze
            </Button>
            <Select value={action.assigneeId ?? ""} onValueChange={(id) => onAssign?.(id)}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Assign action">
                <SelectValue placeholder="Assign…" />
              </SelectTrigger>
              <SelectContent>
                {teamMembers.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </article>
  );
}
