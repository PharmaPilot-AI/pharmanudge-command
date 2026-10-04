import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { logoutAction } from "@/lib/auth/actions";
import { acceptPharmacyInvitationMutation } from "@/lib/data/validation";

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: (search: Record<string, unknown>): { invitation?: string } => {
    const result = z.string().uuid().safeParse(search["invitation"]);
    return result.success ? { invitation: result.data } : {};
  },
  head: () => ({
    meta: [
      { title: "Accept invitation — PharmaNudge" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AcceptInvitationPage,
});

function AcceptInvitationPage() {
  const { invitation } = Route.useSearch();
  const { user } = Route.useRouteContext();
  const acceptInvitation = useServerFn(acceptPharmacyInvitationMutation);
  const logout = useServerFn(logoutAction);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState<"accept" | "logout" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const handleAccept = async () => {
    if (!invitation || inFlight.current) return;
    inFlight.current = true;
    setBusy("accept");
    setError(null);

    try {
      await acceptInvitation({ data: { id: invitation } });
      setAccepted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to accept invitation.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  const handleSwitchAccount = async () => {
    if (!invitation || inFlight.current) return;
    inFlight.current = true;
    setBusy("logout");
    setError(null);

    try {
      await logout();
      window.location.assign(`/accept-invitation?invitation=${encodeURIComponent(invitation)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign out.");
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{accepted ? "Invitation accepted" : "Pharmacy invitation"}</CardTitle>
          <CardDescription>
            {accepted
              ? "Your pharmacy membership is ready."
              : "Use the verified email account that received this invitation."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!invitation ? (
            <p role="alert" className="text-sm">
              This invitation link is invalid. Ask the pharmacy owner for a new link.
            </p>
          ) : accepted ? (
            <Button asChild>
              <a href="/">Continue to PharmaNudge</a>
            </Button>
          ) : !user ? (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in to review and accept your invitation.
              </p>
              <Button asChild>
                <Link to="/login" search={{ redirect: undefined, invitation }}>
                  Sign in
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/register" search={{ invitation }}>
                  Create account
                </Link>
              </Button>
            </>
          ) : (
            <>
              <p className="break-all text-sm">Signed in as {user.email ?? "your account"}.</p>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button disabled={busy !== null} onClick={() => void handleAccept()}>
                {busy === "accept" ? "Accepting…" : "Accept invitation"}
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                onClick={() => void handleSwitchAccount()}
              >
                {busy === "logout" ? "Signing out…" : "Use a different account"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
