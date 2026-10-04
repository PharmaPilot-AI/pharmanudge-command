import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { registerStaffAction } from "@/lib/auth/actions";

export const Route = createFileRoute("/register")({
  validateSearch: (search: Record<string, unknown>): { invitation?: string } => {
    const result = z.string().uuid().safeParse(search["invitation"]);
    return result.success ? { invitation: result.data } : {};
  },
  beforeLoad: ({ context, search }) => {
    if (context.user && search.invitation) {
      throw redirect({
        to: "/accept-invitation",
        search: { invitation: search.invitation },
      });
    }
  },
  head: () => ({
    meta: [
      { title: "Create account — PharmaNudge" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { invitation } = Route.useSearch();
  const register = useServerFn(registerStaffAction);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!invitation || inFlight.current) return;

    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") ?? "")
      .trim()
      .toLowerCase();
    const password = String(fields.get("password") ?? "");
    const confirmation = String(fields.get("confirmation") ?? "");

    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await register({ data: { email, password, invitation } });
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create an account.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{submitted ? "Check your email" : "Create your staff account"}</CardTitle>
          <CardDescription>
            Use the email address that received your pharmacy invitation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!invitation ? (
            <p role="alert" className="text-sm">
              Open the invitation link provided by your pharmacy owner to create an account.
            </p>
          ) : submitted ? (
            <>
              <p className="text-sm text-muted-foreground">
                If registration can proceed, a verification email will arrive shortly. Open it to
                verify your email, then accept your pharmacy invitation. If you already have an
                account, sign in instead.
              </p>
              <Button asChild variant="outline">
                <Link to="/login" search={{ redirect: undefined, invitation }}>
                  Sign in
                </Link>
              </Button>
            </>
          ) : (
            <>
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="register-email" className="text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    disabled={busy}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="register-password" className="text-sm font-medium">
                    Password
                  </label>
                  <Input
                    id="register-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                  <p className="text-xs text-muted-foreground">Use at least 8 characters.</p>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="register-confirmation" className="text-sm font-medium">
                    Confirm password
                  </label>
                  <Input
                    id="register-confirmation"
                    name="confirmation"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    disabled={busy}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Button type="submit" disabled={busy}>
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </form>
              <Link
                to="/login"
                search={{ redirect: undefined, invitation }}
                className="text-sm text-primary underline"
              >
                Already have an account? Sign in
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
