import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmStaffEmailAction } from "@/lib/auth/actions";

export const Route = createFileRoute("/confirm-email")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tokenHash?: string; invitation?: string } => {
    const token = z.string().min(1).max(256).safeParse(search["token_hash"]);
    const invitation = z.string().uuid().safeParse(search["invitation"]);
    return {
      ...(token.success ? { tokenHash: token.data } : {}),
      ...(invitation.success ? { invitation: invitation.data } : {}),
    };
  },
  head: () => ({
    meta: [
      { title: "Verify email — PharmaNudge" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ConfirmEmailPage,
});

function ConfirmEmailPage() {
  const { tokenHash, invitation } = Route.useSearch();
  const confirmEmail = useServerFn(confirmStaffEmailAction);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!tokenHash || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // Consume the token only after the user explicitly confirms.
      await confirmEmail({ data: { tokenHash } });
      setVerified(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to verify your email.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{verified ? "Email verified" : "Verify your email"}</CardTitle>
          <CardDescription>
            {verified
              ? "Your account is ready. Continue to your pharmacy invitation."
              : "Confirm your email address to continue setting up your account."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {verified ? (
            <Button asChild>
              <a
                href={
                  invitation
                    ? `/accept-invitation?invitation=${encodeURIComponent(invitation)}`
                    : "/"
                }
              >
                Continue
              </a>
            </Button>
          ) : !tokenHash ? (
            <>
              <p role="alert" className="text-sm">
                This verification link is invalid.
              </p>
              <Link
                to="/login"
                search={{ redirect: undefined }}
                className="text-sm text-primary underline"
              >
                Back to login
              </Link>
            </>
          ) : (
            <>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button disabled={busy} onClick={() => void handleConfirm()}>
                {busy ? "Verifying…" : "Verify email"}
              </Button>
              <Link
                to="/login"
                search={{
                  redirect: undefined,
                  ...(invitation ? { invitation } : {}),
                }}
                className="text-sm text-primary underline"
              >
                Already verified? Sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
