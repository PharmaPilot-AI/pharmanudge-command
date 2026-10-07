import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PharmacyInvitationRole } from "@/lib/data/pharmacy-invitations";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  listPharmacyMembers,
  type PharmacyMemberDirectoryRow,
  type PharmacyRole,
} from "@/lib/data/pharmacy-members";
import {
  updatePharmacyMemberMutation,
  listPharmacyInvitationsQuery,
  cancelPharmacyInvitationMutation,
  createPharmacyInvitationMutation,
  listPharmacyMemberAuditQuery,
} from "@/lib/data/validation";

const getPharmacyMembers = createServerFn({ method: "GET" }).handler(() => listPharmacyMembers());

export const Route = createFileRoute("/users")({
  beforeLoad: ({ context }) => {
    if (context.pharmacyContext?.role !== "owner") {
      throw redirect({
        to: context.pharmacyContext?.role === "accountant" ? "/reports" : "/pos",
      });
    }
  },
  loader: async () => {
    const [members, invitations, accessHistory] = await Promise.all([
      getPharmacyMembers(),
      listPharmacyInvitationsQuery(),
      listPharmacyMemberAuditQuery(),
    ]);
    return { members, invitations, accessHistory };
  },
  head: () => ({
    meta: [
      { title: "Users & Roles — PharmaNudge" },
      {
        name: "description",
        content: "Manage pharmacy members, roles, and access status.",
      },
      { property: "og:title", content: "Users & Roles — PharmaNudge" },
      {
        property: "og:description",
        content: "Manage pharmacy members and their assigned roles.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: UsersPage,
});

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  pharmacist: "secondary",
  cashier: "outline",
  accountant: "outline",
};

const roleLabels: Record<PharmacyRole, string> = {
  owner: "Owner",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
  accountant: "Accountant",
};

function initialsFromEmail(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

/** Real, owner-only pharmacy member directory and access management. */
function UsersPage() {
  const { members, invitations, accessHistory } = Route.useLoaderData();
  const router = useRouter();
  const updateMember = useServerFn(updatePharmacyMemberMutation);
  const cancelInvitation = useServerFn(cancelPharmacyInvitationMutation);
  const createInvitation = useServerFn(createPharmacyInvitationMutation);
  const [invitationEmail, setInvitationEmail] = useState("");
  const [invitationRole, setInvitationRole] = useState<PharmacyInvitationRole>("pharmacist");
  const [isCreatingInvitation, setIsCreatingInvitation] = useState(false);
  const [cancellingInvitationId, setCancellingInvitationId] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const updateInFlight = useRef(false);

  const handleUpdateMember = async (
    member: PharmacyMemberDirectoryRow,
    changes: Partial<Pick<PharmacyMemberDirectoryRow, "role" | "is_active">>,
  ) => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    setSavingUserId(member.user_id);

    try {
      await updateMember({
        data: {
          target_user_id: member.user_id,
          role: changes.role ?? member.role,
          is_active: changes.is_active ?? member.is_active,
        },
      });

      await router.invalidate();
      toast.success("Member access updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update member access");
    } finally {
      updateInFlight.current = false;
      setSavingUserId(null);
    }
  };

  const handleCancelInvitation = async (id: string) => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    setCancellingInvitationId(id);

    try {
      await cancelInvitation({ data: { id } });
      await router.invalidate();
      toast.success("Invitation cancelled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation");
    } finally {
      updateInFlight.current = false;
      setCancellingInvitationId(null);
    }
  };

  const handleCreateInvitation = async () => {
    if (updateInFlight.current) return;
    updateInFlight.current = true;
    setIsCreatingInvitation(true);

    try {
      const result = await createInvitation({
        data: { email: invitationEmail.trim().toLowerCase(), role: invitationRole },
      });
      setInvitationEmail("");

      if (result.emailDelivery.status === "accepted") {
        toast.success("Invitation created. Email submitted for delivery.");
      } else {
        toast.warning(
          "Invitation created, but email sending could not be confirmed. Copy its link and share it with the recipient.",
          { duration: 10000 },
        );
      }

      try {
        await router.invalidate();
      } catch {
        toast.error("Invitation created, but the list could not refresh. Reload this page.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create invitation");
    } finally {
      updateInFlight.current = false;
      setIsCreatingInvitation(false);
    }
  };

  const handleCopyInvitationLink = async (id: string) => {
    const link = new URL("/accept-invitation", window.location.origin);
    link.searchParams.set("invitation", id);

    try {
      await navigator.clipboard.writeText(link.toString());
      toast.success("Invitation link copied");
    } catch {
      toast.error("Unable to copy. Right-click Open link and choose Copy link address.");
    }
  };

  const isBusy = savingUserId !== null || cancellingInvitationId !== null || isCreatingInvitation;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Users & Roles"
        description={`${members.length} ${members.length === 1 ? "member" : "members"} in this pharmacy.`}
      />

      <div className="flex flex-col gap-2.5">
        {members.map((member) => {
          const isSaving = savingUserId === member.user_id;

          return (
            <Card key={member.user_id}>
              <CardContent className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {initialsFromEmail(member.email)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{member.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {member.is_active ? "Active member" : "Inactive member"}
                    </p>
                  </div>

                  <Badge
                    variant={roleBadgeVariant[member.role] ?? "outline"}
                    className="capitalize sm:hidden"
                  >
                    {member.role}
                  </Badge>
                </div>

                <div className="flex items-center gap-3 sm:justify-end">
                  <Select
                    value={member.role}
                    onValueChange={(value) =>
                      void handleUpdateMember(member, { role: value as PharmacyRole })
                    }
                    disabled={isBusy}
                  >
                    <SelectTrigger className="h-9 w-36" aria-label={`Role for ${member.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(roleLabels) as PharmacyRole[]).map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabels[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={member.is_active}
                      onCheckedChange={(isActive) =>
                        void handleUpdateMember(member, { is_active: isActive })
                      }
                      disabled={isBusy}
                      aria-label={`${member.is_active ? "Deactivate" : "Activate"} ${member.email}`}
                    />
                    <span className="w-14 text-xs text-muted-foreground">
                      {isSaving ? "Saving…" : member.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <section className="flex flex-col gap-2.5" aria-labelledby="invitations-heading">
        <h2 id="invitations-heading" className="text-lg font-semibold">
          Invitations
        </h2>
        <Card>
          <CardContent className="p-3.5">
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateInvitation();
              }}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="invitation-email" className="mb-1.5 block text-sm font-medium">
                    Staff email
                  </label>
                  <Input
                    id="invitation-email"
                    type="email"
                    autoComplete="email"
                    placeholder="staff@example.com"
                    required
                    maxLength={254}
                    value={invitationEmail}
                    onChange={(event) => setInvitationEmail(event.target.value)}
                    disabled={isBusy}
                  />
                </div>
                <div>
                  <label htmlFor="invitation-role" className="mb-1.5 block text-sm font-medium">
                    Staff role
                  </label>
                  <Select
                    value={invitationRole}
                    onValueChange={(value) => {
                      if (value === "pharmacist" || value === "cashier" || value === "accountant") {
                        setInvitationRole(value);
                      }
                    }}
                    disabled={isBusy}
                  >
                    <SelectTrigger id="invitation-role" className="w-full sm:w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pharmacist">Pharmacist</SelectItem>
                      <SelectItem value="cashier">Cashier</SelectItem>
                      <SelectItem value="accountant">Accountant</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={isBusy || !invitationEmail.trim()}>
                  {isCreatingInvitation ? "Creating…" : "Create invitation"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Invitations expire after seven days. We email the invitation link to the recipient.
                You can also copy and share the link. The recipient needs a verified account with
                this email address to accept.
              </p>
            </form>
          </CardContent>
        </Card>
        {invitations.length === 0 ? (
          <p className="rounded-xl border p-3.5 text-sm text-muted-foreground">
            No invitations yet.
          </p>
        ) : (
          invitations.map((invitation) => (
            <Card key={invitation.id}>
              <CardContent className="flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {roleLabels[invitation.role]} · Expires{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Africa/Lagos",
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }).format(new Date(invitation.expires_at))}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline" className="capitalize">
                    {invitation.status}
                  </Badge>
                  {invitation.status === "pending" && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        aria-label={`Copy invitation link for ${invitation.email}`}
                        onClick={() => void handleCopyInvitationLink(invitation.id)}
                      >
                        Copy link
                      </Button>
                      <a
                        className="text-sm text-primary underline"
                        href={`/accept-invitation?invitation=${encodeURIComponent(invitation.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open invitation for ${invitation.email}`}
                      >
                        Open link
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isBusy}
                        aria-label={`Cancel invitation for ${invitation.email}`}
                        onClick={() => void handleCancelInvitation(invitation.id)}
                      >
                        {cancellingInvitationId === invitation.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <section className="flex flex-col gap-2.5" aria-labelledby="access-history-heading">
        <h2 id="access-history-heading" className="text-lg font-semibold">
          Access history
        </h2>
        <p className="text-xs text-muted-foreground">
          Latest 50 member access changes. Times shown in Lagos time.
        </p>
        {accessHistory.length === 0 ? (
          <p className="rounded-xl border p-3.5 text-sm text-muted-foreground">
            No member access changes recorded yet.
          </p>
        ) : (
          accessHistory.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="flex flex-col gap-2 p-3.5">
                <p className="break-all text-sm font-semibold">
                  {entry.target_email ?? `User ${entry.target_user_id}`}
                </p>
                <div className="flex flex-col gap-1 text-sm">
                  {entry.old_role !== entry.new_role && (
                    <p>
                      Role: {roleLabels[entry.old_role]} → {roleLabels[entry.new_role]}
                    </p>
                  )}
                  {entry.old_is_active !== entry.new_is_active && (
                    <p>
                      Access: {entry.old_is_active ? "Active" : "Inactive"} →{" "}
                      {entry.new_is_active ? "Active" : "Inactive"}
                    </p>
                  )}
                </div>
                <p className="break-all text-xs text-muted-foreground">
                  Changed by {entry.actor_email ?? `User ${entry.actor_user_id}`}
                </p>
                <time dateTime={entry.created_at} className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Africa/Lagos",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  }).format(new Date(entry.created_at))}
                </time>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p>
          Only an active owner can change roles or member access. The final active owner cannot be
          demoted or deactivated.
        </p>
      </div>
    </div>
  );
}
