import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, KeyRound } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { EmptyState } from "@/components/feedback/EmptyState";
import { CredentialForm } from "@/components/CredentialForm";
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
import { completePasswordResetAction } from "@/lib/auth/actions";

const resetPasswordFormSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>) => ({
    tokenHash: typeof search["token_hash"] === "string" ? search["token_hash"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Reset password — PharmaNudge" },
      { name: "description", content: "Choose a new password for your PharmaNudge account." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { tokenHash } = Route.useSearch();

  if (!tokenHash) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <EmptyState
          icon={Ban}
          title="Invalid or expired link"
          description="This password reset link is invalid or has expired. Please request a new one from the login page."
          actionLabel="Back to login"
          actionTo="/login"
        />
      </div>
    );
  }

  return <ResetPasswordForm tokenHash={tokenHash} />;
}

/**
 * Verify the recovery token only on explicit submit, never on page load.
 */
function ResetPasswordForm({ tokenHash }: { tokenHash: string }) {
  const navigate = useNavigate();
  const completeReset = useServerFn(completePasswordResetAction);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const onSubmit = async (values: ResetPasswordFormValues) => {
    setIsSubmitting(true);
    try {
      await completeReset({ data: { tokenHash, newPassword: values.newPassword } });
      toast.success("Password updated. You can now log in.");
      await navigate({ to: "/login", search: { redirect: undefined } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reset password.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            Choose a new password
          </CardTitle>
          <CardDescription>Enter and confirm your new password.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <CredentialForm onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm new password</FormLabel>
                    <FormControl>
                      <Input type="password" autoComplete="new-password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={isSubmitting} className="mt-2">
                {isSubmitting ? "Updating…" : "Update password"}
              </Button>
            </CredentialForm>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
