import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { toast } from "sonner";
import { ActionCard } from "@/components/actions/ActionCard";
import { EmptyState } from "@/components/feedback/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { initialActions, teamMembers } from "@/lib/mock-data";
import type { ActionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/actions")({
  head: () => ({
    meta: [
      { title: "Action Center — PharmaPilot AI" },
      { name: "description", content: "The top actions your pharmacy needs right now — resolve, snooze or assign them." },
      { property: "og:title", content: "Action Center — PharmaPilot AI" },
      { property: "og:description", content: "The top actions your pharmacy needs right now." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ActionCenter,
});

const tabs: { id: ActionStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "snoozed", label: "Snoozed" },
  { id: "resolved", label: "Resolved" },
];

/**
 * Action Center — prioritized work queue. Resolve / Snooze / Assign are
 * local Phase 1 interactions backed by mock state.
 */
function ActionCenter() {
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({});
  const [assignees, setAssignees] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<ActionStatus>("open");

  const withState = useMemo(
    () =>
      initialActions.map((a) => ({
        ...a,
        status: statuses[a.id] ?? ("open" as ActionStatus),
        assigneeId: assignees[a.id] ?? a.assigneeId,
      })),
    [statuses, assignees],
  );

  const counts = useMemo(() => {
    const c: Record<ActionStatus, number> = { open: 0, snoozed: 0, resolved: 0 };
    for (const a of withState) c[a.status] += 1;
    return c;
  }, [withState]);

  const visible = withState.filter((a) => a.status === tab);

  const setStatus = (id: string, status: ActionStatus, message: string) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
    toast.success(message);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Action Center"
        description="What should I do next? — the few things that matter, in priority order."
      />

      <div className="mb-4 flex gap-1.5 rounded-lg border bg-muted p-1" role="tablist" aria-label="Action status">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "min-h-9 flex-1 rounded-md px-3 text-sm font-medium transition-colors",
              tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-secondary-foreground">
              {counts[t.id]}
            </span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Zap}
          title={`No ${tab} actions`}
          description={
            tab === "open"
              ? "Everything is under control. New risks will appear here as they emerge."
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              status={action.status}
              onResolve={() => setStatus(action.id, "resolved", `Resolved: ${action.title}`)}
              onSnooze={() => setStatus(action.id, "snoozed", `Snoozed until tomorrow: ${action.title}`)}
              onAssign={(memberId) => {
                setAssignees((prev) => ({ ...prev, [action.id]: memberId }));
                const name = teamMembers.find((m) => m.id === memberId)?.name;
                toast.success(`Assigned to ${name ?? "team member"}`);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
