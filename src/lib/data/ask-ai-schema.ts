import { z } from "zod";

// A conservative business-only guard, not comprehensive PII detection.
// Keep questions out of the provider entirely when obvious personal/clinical
// material appears; owners must still avoid including any sensitive data.
const businessQuestion = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine(
    (question) =>
      !/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(question) &&
      !/(?:\+?\d[\s().-]*){7,}/.test(question) &&
      !/\b(patient\w*|diagnos\w*|dos(?:e|es|age|ing)|symptoms?|prescri\w*|treat(?:ment|ing)?|mg|ml)\b/i.test(
        question,
      ),
    "Ask business-only questions. Do not include personal data, diagnosis or dosing information.",
  );

export const askAiInputSchema = z
  .object({
    question: businessQuestion,
    period: z.enum(["today", "week", "month"]),
  })
  .strict();

export const aiFactSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    text: z.string().min(1).max(1000),
    source_label: z.string().min(1).max(100),
    source_path: z.enum(["/money", "/reports", "/inventory", "/expiry", "/close-day"]),
  })
  .strict();

// Model-generated text is advisory, never a verified fact or executable command.
export const aiAdvisorySchema = z
  .object({
    explanation: z.string().trim().min(1).max(3000),
    recommendations: z.array(z.string().trim().min(1).max(800)).max(5),
    fact_ids: z.array(z.string().max(80)).max(30),
  })
  .strict();

export type AskAiInput = z.infer<typeof askAiInputSchema>;
export type AiFact = z.infer<typeof aiFactSchema>;
export type AiAdvisory = z.infer<typeof aiAdvisorySchema>;
