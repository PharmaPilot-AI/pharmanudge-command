import "@tanstack/react-start/server-only";
import { z } from "zod";
import { getSiteUrl } from "../auth/site-url";

const emailConfigSchema = z.object({
  APP_RESEND_API_KEY: z.string().trim().min(1),
});

const invitationEmailSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().max(254),
  role: z.enum(["pharmacist", "cashier", "accountant"]),
});

const resendResponseSchema = z.object({
  id: z.string().min(1),
});

export type InvitationEmailResult = { status: "accepted"; emailId: string } | { status: "failed" };

/** Called only after the data layer authorizes the owner and resolves the recipient. */
export async function sendPharmacyInvitationEmail(
  input: z.infer<typeof invitationEmailSchema>,
): Promise<InvitationEmailResult> {
  try {
    const invitation = invitationEmailSchema.parse(input);
    const config = emailConfigSchema.parse({
      APP_RESEND_API_KEY: process.env["APP_RESEND_API_KEY"],
    });
    const link = new URL("/accept-invitation", getSiteUrl());
    const isLocalDevelopment =
      process.env["NODE_ENV"] === "development" &&
      link.protocol === "http:" &&
      (link.hostname === "127.0.0.1" || link.hostname === "localhost");

    if (link.protocol !== "https:" && !isLocalDevelopment) {
      return { status: "failed" };
    }
    link.searchParams.set("invitation", invitation.id);

    const roleLabels = {
      pharmacist: "Pharmacist",
      cashier: "Cashier",
      accountant: "Accountant",
    };

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.APP_RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `pharmacy-invitation/${invitation.id}`,
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        from: "PharmaNudge <noreply@notify.pharmanudge.com>",
        to: [invitation.email],
        subject: "Your PharmaNudge pharmacy invitation",
        text: [
          "You have been invited to join a pharmacy on PharmaNudge.",
          `Assigned role: ${roleLabels[invitation.role]}.`,
          "",
          "Open this link to sign in or create an account:",
          link.toString(),
          "",
          "Use this email address and verify it before accepting.",
          "The invitation expires seven days after creation and may be cancelled by the owner.",
          "",
          "If you were not expecting this invitation, you can ignore this email.",
        ].join("\n"),
      }),
    });

    if (!response.ok) return { status: "failed" };
    const result = resendResponseSchema.safeParse(await response.json());
    if (!result.success) return { status: "failed" };

    return { status: "accepted", emailId: result.data.id };
  } catch {
    // Never expose provider responses, credentials, or recipient details.
    return { status: "failed" };
  }
}
