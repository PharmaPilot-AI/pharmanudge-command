import { createFileRoute } from "@tanstack/react-router";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { RecommendationsBlock, VerifiedFactsBlock } from "@/components/ai/AiAnswerBlocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/PageHeader";
import { aiMockFallback, aiScriptedAnswers, suggestedPrompts } from "@/lib/mock-data";
import type { AiChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ask-ai")({
  head: () => ({
    meta: [
      { title: "Ask PharmaNudge — PharmaNudge" },
      {
        name: "description",
        content:
          "Ask questions about your pharmacy's sales, cash and stock. Answers separate verified facts from recommendations.",
      },
      { property: "og:title", content: "Ask PharmaNudge" },
      {
        property: "og:description",
        content: "Decision intelligence for your pharmacy — facts first, then advice.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: AskAi,
});

let messageSeq = 0;
const nextId = () => `m${++messageSeq}`;

const greeting: AiChatMessage = {
  id: nextId(),
  role: "assistant",
  text: "Good morning, Adaeze. Ask me about today's sales, cash, or stock — I answer with verified facts from your records first, then recommendations.",
};

/**
 * Ask PharmaNudge. Phase 1 is a scripted demo: suggested questions replay
 * curated answers; anything else is clearly labeled a mock response — the UI
 * never pretends a real model answered.
 */
function AskAi() {
  const [messages, setMessages] = useState<AiChatMessage[]>([greeting]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const ask = (question: string) => {
    const trimmed = question.trim();
    if (!trimmed) return;
    const scripted = aiScriptedAnswers[trimmed.toLowerCase()];
    const answer: AiChatMessage = scripted
      ? { id: nextId(), role: "assistant", ...scripted }
      : { id: nextId(), role: "assistant", text: aiMockFallback };
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: trimmed }, answer]);
    setInput("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col" style={{ minHeight: "calc(100dvh - 12rem)" }}>
      <PageHeader
        title="Ask PharmaNudge"
        description="Advisory answers grounded in your records. AI never changes your books or stock."
      />

      {/* Thread */}
      <div className="flex flex-1 flex-col gap-4" role="log" aria-label="Conversation">
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
          >
            <div
              className={cn(
                "max-w-[92%] sm:max-w-[85%]",
                m.role === "user"
                  ? "rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground"
                  : "w-full",
              )}
            >
              {m.role === "user" ? (
                m.text
              ) : (
                <div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Sparkles className="h-4 w-4" aria-hidden />
                    </span>
                    <p className="text-sm leading-relaxed">{m.text}</p>
                  </div>
                  {m.facts && <VerifiedFactsBlock facts={m.facts} sources={m.sources} />}
                  {m.recommendations && <RecommendationsBlock items={m.recommendations} />}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Suggested prompts */}
      <div className="mt-4 flex flex-wrap gap-2">
        {suggestedPrompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => ask(prompt)}
            className="min-h-9 rounded-full border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            {prompt}
          </button>
        ))}
      </div>

      {/* Composer */}
      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about sales, cash, or stock…"
          className="h-12 flex-1 text-base"
          aria-label="Ask PharmaNudge a question"
        />
        <Button
          type="submit"
          size="lg"
          className="h-12 w-12 shrink-0 p-0"
          disabled={!input.trim()}
          aria-label="Send"
        >
          <Send className="h-5 w-5" />
        </Button>
      </form>
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Phase 1 preview — responses are scripted demonstrations, not live AI.
      </p>
    </div>
  );
}
