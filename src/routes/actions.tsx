import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  pharmacyActionQueueQuery,
  refreshPharmacyActionsMutation,
  updatePharmacyActionMutation,
} from "@/lib/data/validation";
import type { SavedAction, UpdateActionInput } from "@/lib/data/action-schema";

export const Route = createFileRoute("/actions")({
  beforeLoad: ({ context }) => {
    if (context.pharmacyContext?.role !== "owner") {
      throw redirect({ to: "/pos" });
    }
  },
  loader: () => pharmacyActionQueueQuery(),
  head: () => ({
    meta: [
      { title: "Action Center — PharmaNudge" },
      { name: "description", content: "Review pharmacy risks and track owner follow-up." },
    ],
  }),
  component: ActionCenter,
});

type Tab = "open" | "snoozed" | "resolved" | "inactive";
const tabs: { value: Tab; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "snoozed", label: "Snoozed" },
  { value: "resolved", label: "Reviewed" },
  { value: "inactive", label: "No longer detected" },
];

function sourceLink(kind: SavedAction["action_kind"]): {
  to: "/inventory" | "/expiry" | "/close-day";
  label: string;
} {
  if (kind === "out_of_stock") return { to: "/inventory", label: "Review inventory" };
  if (kind === "expired_batch" || kind === "expiring_batch") {
    return { to: "/expiry", label: "Review expiry" };
  }
  return { to: "/close-day", label: "Review reconciliation" };
}

function ActionCenter() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const refreshRisks = useServerFn(refreshPharmacyActionsMutation);
  const updateAction = useServerFn(updatePharmacyActionMutation);
  const [tab, setTab] = useState<Tab>("open");
  const [busy, setBusy] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const busyRef = useRef(false);
  const locked = busy || reloadRequired;
  const activeMembers = data.members.filter((member) => member.is_active);

  const matches = (action: Pick<SavedAction, "source_active" | "status">, value: Tab) =>
    value === "inactive" ? !action.source_active : action.source_active && action.status === value;

  const visible = data.actions.filter((action) => matches(action, tab));

  async function run(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setReloadRequired(true);
    try {
      await operation();
      await router.invalidate();
      setReloadRequired(false);
    } catch {
      toast.error(
        "The result could not be confirmed or reloaded. Reload the saved queue before another update.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function change(
    action: Pick<SavedAction, "action_id" | "version">,
    command: UpdateActionInput["command"],
    assignedUserId?: string,
  ) {
    if (locked) return;
    void run(async () => {
      const result = await updateAction({
        data: {
          action_id: action.action_id,
          expected_version: action.version,
          command,
          ...(assignedUserId === undefined ? {} : { assigned_user_id: assignedUserId }),
        },
      });
      if (result.status === "rejected") {
        toast.error(result.message);
      } else {
        toast.success("Action updated.");
      }
    });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader
        title="Action Center"
        description="Review recorded risks and track follow-up without changing your books or stock."
      />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{data.date} · Lagos business day</p>
        <Button
          disabled={locked}
          onClick={() =>
            void run(async () => {
              await refreshRisks();
              toast.success("Pharmacy risks refreshed.");
            })
          }
        >
          {busy ? "Please wait…" : "Refresh risks"}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {})}>
          Reload saved queue
        </Button>
      </div>

      {reloadRequired && !busy && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          Reload the saved queue to check whether the last update succeeded before trying again.
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        Refresh risks checks current records. Reviewed means you acknowledged the action; it does
        not mean the underlying risk has disappeared. Changed evidence reopens an action. Continuing
        risks appear again on the next business day.
      </p>

      <div className="flex flex-wrap gap-2" aria-label="Filter actions">
        {tabs.map((item) => (
          <Button
            key={item.value}
            variant={tab === item.value ? "default" : "outline"}
            aria-pressed={tab === item.value}
            onClick={() => setTab(item.value)}
          >
            {item.label} ({data.actions.filter((action) => matches(action, item.value)).length})
          </Button>
        ))}
      </div>

      {visible.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No saved actions in this view. Use Refresh risks to check current records. Low-stock
            alerts require reorder thresholds and are not included yet.
          </CardContent>
        </Card>
      )}

      {visible.map((action) => {
        const link = sourceLink(action.action_kind);
        const assignee = data.members.find((member) => member.user_id === action.assignee_user_id);
        return (
          <Card key={action.action_id}>
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex flex-wrap gap-2 text-xs font-semibold">
                <span
                  className={
                    action.severity === "critical" ? "text-destructive" : "text-muted-foreground"
                  }
                >
                  {action.severity.toUpperCase()}
                </span>
                <span>
                  {action.source_active
                    ? action.status === "resolved"
                      ? "Reviewed"
                      : action.status
                    : "No longer detected at last refresh"}
                </span>
              </div>
              <h2 className="text-sm font-semibold">{action.title}</h2>
              <p className="text-sm text-muted-foreground">{action.detail}</p>
              {action.snoozed_until && (
                <p className="text-xs text-muted-foreground">
                  Snoozed until {action.snoozed_until}
                </p>
              )}
              {action.assignee_user_id && (
                <p className="break-all text-xs text-muted-foreground">
                  Assigned to {assignee?.email || action.assignee_user_id}
                  {!action.assignee_is_active && " · inactive member; reassign if needed"}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link to={link.to}>{link.label}</Link>
                </Button>
                {action.source_active && (
                  <>
                    {action.status !== "resolved" && (
                      <Button disabled={locked} size="sm" onClick={() => change(action, "resolve")}>
                        Mark reviewed
                      </Button>
                    )}
                    {action.status === "open" && (
                      <Button
                        disabled={locked}
                        variant="outline"
                        size="sm"
                        onClick={() => change(action, "snooze")}
                      >
                        Snooze until tomorrow
                      </Button>
                    )}
                    {action.status !== "open" && (
                      <Button
                        disabled={locked}
                        variant="outline"
                        size="sm"
                        onClick={() => change(action, "reopen")}
                      >
                        Reopen
                      </Button>
                    )}
                    <select
                      aria-label={`Assign: ${action.title}`}
                      className="h-9 max-w-full rounded-md border bg-background px-2 text-sm"
                      disabled={locked}
                      value={action.assignee_user_id ?? ""}
                      onChange={(event) => {
                        const id = event.target.value;
                        change(action, id ? "assign" : "unassign", id || undefined);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {action.assignee_user_id && !action.assignee_is_active && (
                        <option value={action.assignee_user_id} disabled>
                          {assignee?.email || action.assignee_user_id} (inactive)
                        </option>
                      )}
                      {activeMembers.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {member.email} · {member.role}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
