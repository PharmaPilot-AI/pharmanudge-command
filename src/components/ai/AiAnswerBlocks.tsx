import { Link } from "@tanstack/react-router";
import { ArrowRight, Lightbulb, ShieldCheck } from "lucide-react";

/**
 * Advisory answer structure. VERIFIED FACTS (traceable to records) and
 * RECOMMENDATIONS (advice) are always visually separated — PharmaNudge
 * never silently alters financial or inventory records.
 */

export function VerifiedFactsBlock({
  facts,
  sources,
}: {
  facts: string[];
  sources?: { label: string; path: string }[] | undefined;
}) {
  return (
    <section className="mt-3 rounded-xl border bg-card p-3.5" aria-label="Verified facts">
      <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-primary">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Verified facts
      </h4>
      <ul className="mt-2 flex flex-col gap-1.5">
        {facts.map((fact) => (
          <li key={fact} className="flex gap-2 text-sm leading-snug">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>{fact}</span>
          </li>
        ))}
      </ul>
      {sources && sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t pt-2.5">
          {sources.map((s) => (
            <Link
              key={s.path + s.label}
              to={s.path as "/"}
              className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
            >
              {s.label}
              <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecommendationsBlock({ items }: { items: string[] }) {
  return (
    <section
      className="mt-2 rounded-xl border border-warning/30 bg-warning/5 p-3.5"
      aria-label="Recommendations"
    >
      <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-warning">
        <Lightbulb className="h-3.5 w-3.5" aria-hidden />
        Recommendations
      </h4>
      <ol className="mt-2 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={item} className="flex gap-2 text-sm leading-snug">
            <span className="shrink-0 font-semibold tabular-nums text-warning">{i + 1}.</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 border-t border-warning/20 pt-2 text-[11px] text-muted-foreground">
        Advisory only — PharmaNudge never changes financial or inventory records on its own.
      </p>
    </section>
  );
}
