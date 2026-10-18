import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Send, Sparkles } from "lucide-react";
import type { askPharmaNudgeAction } from "@/lib/data/validation";

type AskResponse = Awaited<ReturnType<typeof askPharmaNudgeAction>>;
type Period = "today" | "week" | "month";
type AskSubmit = (options: { data: { question: string; period: Period } }) => Promise<AskResponse>;

const prompts = [
  "How is my pharmacy performing?",
  "What stock needs attention?",
  "What should I review before closing the day?",
];

/** Only a deliberate form submit invokes the server action. No mount or selection effects. */
export function AskPharmaNudgePanel({ submit }: { submit: AskSubmit }) {
  const [question, setQuestion] = useState("");
  const [period, setPeriod] = useState<Period>("today");
  const [pending, setPending] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);
  const [previous, setPrevious] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const questionInput = useRef<HTMLTextAreaElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const trimmed = question.trim();
    if (!trimmed || question.length > 1000) {
      setError("Enter a business question of 1–1,000 characters.");
      return;
    }
    // Eager ref guards same-tick submissions before React applies disabled state.
    lock.current = true;
    setPending(true);
    setError("");
    setPrevious(true);
    try {
      const next = await submit({ data: { question: trimmed, period } });
      setResponse(next);
      setPrevious(false);
    } catch {
      // Never expose server/provider exception bodies, and never retain stale AI advice.
      setError("The request could not be completed. Evidence was not updated. Please try again.");
    } finally {
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-start gap-2 text-sm">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <p>
          Ask a business question about your sales, cash or stock. Database evidence comes first; AI
          suggestions are separate and may be wrong.
        </p>
      </div>
      <p
        id="ask-privacy"
        className="rounded-xl border bg-muted/30 p-3 text-sm text-muted-foreground"
      >
        Business questions only. Do not include patient information, names, emails or contact data.
        This is not clinical advice. Only a server-selected business-topic summary, not your
        original wording, is sent with aggregate evidence to an AI provider. Advice covers those
        topics, not arbitrary details in your question. No business records are changed.
      </p>
      <form
        onSubmit={handleSubmit}
        aria-label="Ask PharmaNudge"
        aria-busy={pending}
        className="space-y-3"
      >
        <div>
          <label htmlFor="ask-period" className="mb-1 block text-sm font-medium">
            Financial period
          </label>
          <select
            id="ask-period"
            value={period}
            disabled={pending}
            onChange={(event) => setPeriod(event.target.value as Period)}
            className="min-h-12 w-full rounded-lg border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
          >
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
          </select>
        </div>
        <div>
          <label htmlFor="ask-question" className="mb-1 block text-sm font-medium">
            Your business question
          </label>
          <textarea
            ref={questionInput}
            id="ask-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={pending}
            required
            maxLength={1000}
            rows={3}
            aria-describedby="ask-privacy ask-length"
            className="min-h-28 w-full resize-y rounded-lg border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Ask about sales, cash or stock…"
          />
          <p id="ask-length" className="mt-1 text-xs text-muted-foreground">
            {question.length}/1,000 characters. Select a suggestion to edit it, then send.
          </p>
        </div>
        <div aria-label="Suggested business questions" className="flex flex-wrap gap-2">
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={pending}
              onClick={() => {
                setQuestion(prompt);
                questionInput.current?.focus();
              }}
              className="min-h-11 rounded-xl border bg-card px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {prompt}
            </button>
          ))}
        </div>
        <button
          type="submit"
          disabled={pending || !question.trim() || question.length > 1000}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {pending ? "Asking PharmaNudge…" : "Ask PharmaNudge"}
        </button>
      </form>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {pending
          ? "Retrieving evidence and requesting AI advice. Please wait."
          : response && !previous
            ? "Response ready. Review database evidence and advisory separately below."
            : "Only sending the form requests an answer."}
      </p>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {response && <AskPharmaNudgeEvidence response={response} previous={previous} />}
    </div>
  );
}

/** Database facts and model text deliberately have separate visual and trust boundaries. */
export function AskPharmaNudgeEvidence({
  response,
  previous = false,
}: {
  response: AskResponse;
  previous?: boolean;
}) {
  const { evidence, advice } = response;
  return (
    <div className="min-w-0 space-y-4 break-words text-sm">
      <section aria-labelledby="ask-evidence-heading" className="rounded-xl border bg-card p-4">
        <h2 id="ask-evidence-heading" className="font-semibold">
          Database evidence
        </h2>
        {previous && (
          <p role="status" className="mt-2 font-medium">
            Previous evidence — not updated for this request.
          </p>
        )}
        <p className="mt-2 text-muted-foreground">
          Financial period: {evidence.period} · Business date: {evidence.businessDate} (Lagos).
        </p>
        <p className="text-muted-foreground">
          Retrieved: <time dateTime={evidence.retrievedAt}>{evidence.retrievedAt}</time>
        </p>
        <p className="mt-2 text-muted-foreground">
          Stock and expiry figures are current at retrieval, not historical figures for the
          financial period.
        </p>
        <ul className="mt-3 space-y-3">
          {evidence.facts.map((fact, index) => (
            <li key={fact.id} id={`ask-fact-${index}`} className="scroll-mt-24">
              <p className="whitespace-pre-wrap">{fact.text}</p>
              {fact.source_path === "/reports" ? (
                <Link
                  to="/reports"
                  search={{ period: evidence.period }}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  {fact.source_label}
                </Link>
              ) : fact.source_path === "/money" ? (
                <Link
                  to="/money"
                  search={() => ({ period: evidence.period })}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  {fact.source_label}
                </Link>
              ) : (
                <Link
                  to={fact.source_path}
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                >
                  {fact.source_label}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {evidence.facts.length === 0 && <p className="mt-3">No evidence facts were returned.</p>}
        <h3 className="mt-3 font-medium">Evidence limitations</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
          {evidence.limitations.map((text, index) => (
            <li key={index}>{text}</li>
          ))}
        </ul>
      </section>
      {!previous && (
        <section
          aria-labelledby="ask-advice-heading"
          className="rounded-xl border border-dashed bg-muted/30 p-4"
        >
          <h2 id="ask-advice-heading" className="font-semibold">
            AI advisory — not verified
          </h2>
          <p className="mt-2 text-muted-foreground">
            AI may be wrong. Review the source records and use your judgement before acting. This
            does not change your books or stock and is not clinical advice.
          </p>
          {advice.status === "available" ? (
            <>
              <p className="mt-3 whitespace-pre-wrap">{advice.advisory.explanation}</p>
              <ul className="mt-3 list-disc space-y-2 pl-5">
                {advice.advisory.recommendations.map((text, index) => (
                  <li key={index} className="whitespace-pre-wrap">
                    {text}
                  </li>
                ))}
              </ul>
              <nav aria-label="Evidence referenced by AI" className="mt-3 flex flex-wrap gap-x-4">
                {evidence.facts.map((fact, index) =>
                  advice.advisory.fact_ids.includes(fact.id) ? (
                    <a
                      key={fact.id}
                      href={`#ask-fact-${index}`}
                      className="inline-flex min-h-11 items-center text-primary underline"
                    >
                      Evidence {index + 1}
                    </a>
                  ) : null,
                )}
              </nav>
            </>
          ) : (
            <p role="status" className="mt-3">
              {unavailableMessages[advice.reason]} Database evidence remains available above; no
              usable AI advisory is available for this request.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

const unavailableMessages = {
  configuration: "AI advice is not configured.",
  usage_limit: "The AI usage limit has been reached.",
  rate_limit: "AI advice is temporarily rate limited. Try again later.",
  provider: "The AI provider is temporarily unavailable.",
  reservation: "AI advice could not be reserved. Try again later.",
} as const;
