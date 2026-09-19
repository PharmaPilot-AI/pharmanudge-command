import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { teamMembers } from "@/lib/mock-data";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users & Roles — PharmaNudge" },
      { name: "description", content: "Team members and their roles. Permissions are enforced server-side in Phase 2." },
      { property: "og:title", content: "Users & Roles — PharmaNudge" },
      { property: "og:description", content: "Team members and their roles." },
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

/** Read-only users & roles placeholder — no real auth in Phase 1. */
function UsersPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader
        title="Users & Roles"
        description="Who can do what. Role permissions will be enforced server-side in Phase 2."
        actions={
          <Button size="sm" className="gap-1" onClick={() => toast.info("Invitations arrive with real authentication in Phase 2")}>
            <UserPlus className="h-4 w-4" aria-hidden />
            Invite
          </Button>
        }
      />

      <div className="flex flex-col gap-2.5">
        {teamMembers.map((m) => (
          <Card key={m.id}>
            <CardContent className="flex items-center gap-3 p-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {m.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.name}</p>
                <p className="text-xs text-muted-foreground">{m.roleLabel}</p>
              </div>
              <Badge variant={roleBadgeVariant[m.role] ?? "outline"} className="capitalize">
                {m.role}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-info/30 bg-info/5 p-3.5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <p>
          Phase 1 shows the whole app to every mock user. With real authentication, the server
          will enforce what each role can see and do — the interface will never be the only
          line of defence.
        </p>
      </div>
    </div>
  );
}
