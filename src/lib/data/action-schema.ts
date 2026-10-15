import { z } from "zod";

export const actionStatusSchema = z.enum(["open", "snoozed", "resolved"]);
export const actionKindSchema = z.enum([
  "out_of_stock",
  "expired_batch",
  "expiring_batch",
  "cash_variance",
  "unreconciled_day",
]);

const versionSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine(
    (value) => BigInt(value) < BigInt(Number.MAX_SAFE_INTEGER),
    "Refresh the action queue before updating.",
  );

export const savedActionSchema = z
  .object({
    action_id: z.string().uuid(),
    business_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    action_key: z.string().min(1).max(200),
    action_kind: actionKindSchema,
    severity: z.enum(["critical", "warning", "info"]),
    title: z.string().min(1).max(300),
    detail: z.string().min(1).max(2000),
    source_snapshot: z.record(z.string(), z.unknown()),
    source_active: z.boolean(),
    status: actionStatusSchema,
    snoozed_until: z.string().nullable(),
    assignee_user_id: z.string().uuid().nullable(),
    assignee_is_active: z.boolean(),
    resolved_by: z.string().uuid().nullable(),
    resolved_at: z.string().datetime({ offset: true }).nullable(),
    version: versionSchema,
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

export const updateActionSchema = z
  .object({
    action_id: z.string().uuid(),
    expected_version: versionSchema,
    command: z.enum(["resolve", "snooze", "reopen", "assign", "unassign"]),
    assigned_user_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.command === "assign" && input.assigned_user_id === undefined) ||
      (input.command !== "assign" && input.assigned_user_id !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["assigned_user_id"],
        message: "Choose a member only when assigning an action.",
      });
    }
  });

export type SavedAction = z.infer<typeof savedActionSchema>;
export type UpdateActionInput = z.infer<typeof updateActionSchema>;
