import { createFileRoute, redirect } from "@tanstack/react-router";
import { AskPharmaNudgePanel } from "@/components/ai/AskPharmaNudgePanel";
import { PageHeader } from "@/components/layout/PageHeader";
import { askPharmaNudgeAction } from "@/lib/data/validation";

export const Route = createFileRoute("/ask-ai")({
  beforeLoad: ({ context }) => {
    if (context.pharmacyContext?.role !== "owner") {
      throw redirect({ to: "/pos" });
    }
  },
  head: () => ({
    meta: [
      { title: "Ask PharmaNudge — PharmaNudge" },
      {
        name: "description",
        content:
          "Ask business questions about your pharmacy's sales, cash and stock. Database evidence is separate from unverified AI advice.",
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

function AskAi() {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col pb-4">
      <PageHeader
        title="Ask PharmaNudge"
        description="Advisory answers grounded in your records. AI never changes your books or stock."
      />
      <AskPharmaNudgePanel submit={askPharmaNudgeAction} />
    </div>
  );
}
