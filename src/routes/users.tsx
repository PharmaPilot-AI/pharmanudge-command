import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { updatePharmacyMemberMutation } from "@/lib/data/validation";

const getPharmacyMembers = createServerFn({ method: "GET" }).handler(() => listPharmacyMembers());

export const Route = createFileRoute("/users")({
  beforeLoad: ({ context }) => {
    if (context.pharmacyContext?.role !== "owner") {
      throw redirect({
        to: context.pharmacyContext?.role === "accountant" ? "/reports" : "/pos",
      });
    }
  },
  loader: () => getPharmacyMembers(),
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
  const members = Route.useLoaderData();
  const router = useRouter();
  const updateMember = useServerFn(updatePharmacyMemberMutation);
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
                    disabled={savingUserId !== null}
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
                      disabled={savingUserId !== null}
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
