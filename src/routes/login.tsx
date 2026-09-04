import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, ShieldOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/feedback/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { loginAction } from "@/lib/auth/actions";
import { isAllowedRedirect, resolveHome } from "@/lib/auth/redirect";
import type { Role } from "@/lib/types";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

/**
 * The redirect search param is re-validated here regardless of where it
 * came from — a user can navigate straight to /login?redirect=... with an
 * arbitrary value, bypassing __root.tsx's own validation of values it
 * generates, so this page can never trust an incoming redirect value
 * without checking it itself.
 */
function resolveLoginTarget(redirectParam: string | undefined, role: Role | undefined): string {
  if (redirectParam && isAllowedRedirect(redirectParam)) return redirectParam;
  return resolveHome(role);
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search["redirect"] === "string" ? search["redirect"] : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    // Only redirect away once fully authenticated (a real session AND an
    // active pharmacy membership) — an authenticated-but-unaffiliated
    // session stays on this page to render the no-membership state below,
    // per Checkpoint 6's scope.
    if (context.user && context.pharmacyContext) {
      throw redirect({ to: resolveLoginTarget(search.redirect, context.pharmacyContext.role) });
    }
  },
  head: () => ({
    meta: [
      { title: "Log in — PharmaPilot AI" },
      { name: "description", content: "Log in to your PharmaPilot AI account." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const search = Route.useSearch();
  const { user, pharmacyContext } = Route.useRouteContext();
  const navigate = useNavigate();
  const login = useServerFn(loginAction);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setIsSubmitting(true);
    try {
      await login({ data: values });
      // Role isn't known yet at this point (context here predates the
      // login that just happened) — falls back to resolveHome(undefined),
      // i.e. "/", when there's no valid redirect target.
      await navigate({ to: resolveLoginTarget(search.redirect, undefined) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to log in.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (user && pharmacyContext === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <EmptyState
          icon={ShieldOff}
          title="No pharmacy membership"
          description="Your account is signed in but isn't linked to an active pharmacy yet. Contact your pharmacy administrator to be added."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            Log in
          </CardTitle>
          <CardDescription>Sign in to your PharmaPilot AI account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="current-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "Logging in…" : "Log in"}
              </Button>
              <Link
                to="/forgot-password"
                className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
