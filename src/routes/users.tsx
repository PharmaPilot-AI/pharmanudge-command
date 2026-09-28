import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listPharmacyMembers } from "@/lib/data/pharmacy-members";

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
        content: "Active and inactive members of your pharmacy and their assigned roles.",
      },
      { property: "og:title", content: "Users & Roles — PharmaNudge" },
      {
        property: "og:description",
        content: "Pharmacy members and their assigned roles.",
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

function initialsFromEmail(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

/** Real, owner-only pharmacy member directory. */
function UsersPage() {
  const members = Route.useLoaderData();

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Users & Roles"
        description={`${members.length} ${members.length === 1 ? "member" : "members"} in this pharmacy.`}
      />

      <div className="flex flex-col gap-2.5">
        {members.map((member) => (
          <Card key={member.user_id}>
            <CardContent className="flex items-center gap-3 p-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {initialsFromEmail(member.email)}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{member.email}</p>
                <p className="text-xs text-muted-foreground">
                  {member.is_active ? "Active member" : "Inactive member"}
                </p>
              </div>

              <Badge variant={roleBadgeVariant[member.role] ?? "outline"} className="capitalize">
                {member.role}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p>
          This directory is read-only. Invitations and role changes will be added through a
          separate, securely audited owner workflow.
        </p>
      </div>
    </div>
  );
}
